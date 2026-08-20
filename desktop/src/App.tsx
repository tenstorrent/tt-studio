// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import BringUpProgress from "./views/BringUpProgress";
import ConnectionPicker from "./views/ConnectionPicker";
import ProfileEditor from "./views/ProfileEditor";
import {
  initialBringUpState,
  parseEventLine,
  reduceEvent,
  type BringUpState,
} from "./lib/events";
import {
  asSecretError,
  checkStackHealth,
  deleteProfile,
  detectHardware,
  listProfiles,
  markLocalAttach,
  markProfileUsed,
  onStackHealth,
  openStack,
  resolveStackCheckout,
  restartStack,
  saveProfile,
  setSshKeyPassphrase,
  startBringUp,
  startHealthPoll,
  stopHealthPoll,
  type HardwareProbe,
  type Profile,
  type StackHealth,
} from "./lib/ipc";

// The real TT-Studio frontend is served by the stack itself — the desktop
// shell navigates this window to it rather than bundling it (the web app
// derives URLs from window.location, so it must load from its own origin).
const STACK_URL = "http://localhost:3000";

type Screen =
  | { name: "loading" }
  | { name: "picker" }
  | { name: "editor"; profile?: Profile }
  // bringUpOnly: a restart is in flight — services may briefly still look
  // healthy, so only the bring-up's own ready event may open the stack.
  | { name: "connecting"; target: Profile | null; bringUpOnly?: boolean };

const STATUS_STYLE: Record<string, string> = {
  up: "bg-emerald-500",
  down: "bg-red-500",
  unreachable: "bg-zinc-600",
};

/** Per-service health checklist shown while waiting for the stack. */
function HealthGate({
  health,
  target,
}: {
  health: StackHealth | null;
  target: Profile | null;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-zinc-100">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {target ? `Connecting to ${target.name}` : "Starting TT-Studio"}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {health?.ready
            ? "All services are up — opening TT-Studio…"
            : "Waiting for all services to come up"}
        </p>
      </header>
      <ul className="flex w-full max-w-sm flex-col gap-2">
        {(health?.services ?? []).map((s) => (
          <li
            key={s.name}
            className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
          >
            <span>{s.name}</span>
            <span className="flex items-center gap-2 text-xs text-zinc-400">
              {s.status}
              <span
                className={`h-2 w-2 rounded-full ${STATUS_STYLE[s.status] ?? "bg-zinc-600"}`}
              />
            </span>
          </li>
        ))}
        {!health && (
          <li className="text-center text-sm text-zinc-500">Checking…</li>
        )}
      </ul>
    </main>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [hardware, setHardware] = useState<HardwareProbe | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [health, setHealth] = useState<StackHealth | null>(null);
  const [bringUp, setBringUp] = useState<BringUpState | null>(null);
  const [keychainWarning, setKeychainWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** One-line status while native mode prepares (checkout clone, --stop). */
  const [prep, setPrep] = useState<string | null>(null);
  /** Whether a local stack already answers its health checks (picker info). */
  const [stackUp, setStackUp] = useState(false);
  const opening = useRef(false);

  useEffect(() => {
    Promise.all([detectHardware(), listProfiles()])
      .then(([hw, saved]) => {
        setHardware(hw);
        setProfiles(saved);
        setScreen({ name: "picker" });
      })
      .catch((e) => {
        setError(String(e));
        setScreen({ name: "picker" });
      });
  }, []);

  // On the picker, take one health snapshot so it can say whether a local
  // stack is already running (read-only GETs).
  useEffect(() => {
    if (screen.name !== "picker") return;
    checkStackHealth()
      .then((h) => setStackUp(h.ready))
      .catch(() => setStackUp(false));
  }, [screen.name]);

  // While connecting: poll stack health, and navigate once everything is up.
  useEffect(() => {
    if (screen.name !== "connecting" || screen.bringUpOnly) return;
    let unlisten: (() => void) | undefined;
    onStackHealth(setHealth).then((fn) => {
      unlisten = fn;
    });
    startHealthPoll().catch((e) => setError(String(e)));
    return () => {
      unlisten?.();
      stopHealthPoll().catch(() => {});
    };
  }, [screen.name]);

  // When a bring-up is running (`python run.py --json-events` piped in by the
  // shell), render its NDJSON stream natively instead of the bare checklist.
  useEffect(() => {
    if (screen.name !== "connecting") return;
    let unlisten: (() => void) | undefined;
    listen<string>("bringup-line", ({ payload }) => {
      const event = parseEventLine(payload);
      if (!event) return;
      setBringUp((prev) => reduceEvent(prev ?? initialBringUpState(), event));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
      setBringUp(null);
    };
  }, [screen.name]);

  const handleBringUpReady = useCallback((appUrl: string) => {
    if (opening.current) return;
    opening.current = true;
    stopHealthPoll()
      .catch(() => {})
      .then(() => openStack(appUrl))
      .catch((e) => {
        opening.current = false;
        setError(String(e));
      });
  }, []);

  useEffect(() => {
    if (
      screen.name !== "connecting" ||
      screen.bringUpOnly ||
      !health?.ready ||
      opening.current
    )
      return;
    opening.current = true;
    stopHealthPoll()
      .catch(() => {})
      .then(() => openStack(STACK_URL))
      .catch((e) => {
        opening.current = false;
        setError(String(e));
      });
  }, [screen.name, health]);

  const connect = useCallback((target: Profile | null) => {
    setHealth(null);
    opening.current = false;
    if (target) markProfileUsed(target.id).catch(() => {});
    setScreen({ name: "connecting", target });
  }, []);

  // Native mode: attach if the stack is already healthy, otherwise resolve
  // the checkout (cloning on first use) and spawn the bring-up.
  const connectLocal = useCallback(async () => {
    setHealth(null);
    opening.current = false;
    setScreen({ name: "connecting", target: null });
    try {
      const current = await checkStackHealth();
      if (current.ready) {
        // Already running: no bring-up — the health poller opens the stack.
        await markLocalAttach();
        return;
      }
      setPrep("Preparing the TT-Studio checkout (first run clones it)…");
      const checkout = await resolveStackCheckout();
      await startBringUp(checkout.path);
    } catch (e) {
      setError(String(e));
      setScreen({ name: "picker" });
    } finally {
      setPrep(null);
    }
  }, []);

  // Explicit "Restart stack": run.py --stop, then a fresh bring-up. Health
  // polling is suppressed (bringUpOnly) so the old, still-draining services
  // can't re-open the stack mid-restart.
  const handleRestart = useCallback(async () => {
    setHealth(null);
    opening.current = false;
    setScreen({ name: "connecting", target: null, bringUpOnly: true });
    setPrep("Stopping the current stack…");
    try {
      const checkout = await resolveStackCheckout();
      await restartStack(checkout.path);
    } catch (e) {
      setError(String(e));
      setScreen({ name: "picker" });
    } finally {
      setPrep(null);
    }
  }, []);

  const handleSave = useCallback(
    async (profile: Profile, passphrase: string | null) => {
      try {
        setProfiles(await saveProfile(profile));
      } catch (e) {
        setError(String(e));
        return;
      }
      if (passphrase !== null) {
        try {
          await setSshKeyPassphrase(profile.id, passphrase);
          setKeychainWarning(null);
        } catch (e) {
          const secretErr = asSecretError(e);
          setKeychainWarning(
            secretErr?.code === "keychain_unavailable"
              ? "No OS keychain is available on this machine, so the passphrase was not saved — use ssh-agent or enter it when connecting."
              : `Couldn't save the passphrase: ${secretErr?.message ?? e}`,
          );
        }
      }
      setScreen({ name: "picker" });
    },
    [],
  );

  const handleDelete = useCallback(async (profile: Profile) => {
    try {
      setProfiles(await deleteProfile(profile.id));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  if (screen.name === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Loading…
      </main>
    );
  }

  if (screen.name === "editor") {
    return (
      <ProfileEditor
        initial={screen.profile}
        keychainWarning={keychainWarning}
        onSave={handleSave}
        onCancel={() => setScreen({ name: "picker" })}
      />
    );
  }

  if (screen.name === "connecting") {
    if (bringUp && bringUp.phases.length > 0) {
      return <BringUpProgress state={bringUp} onReady={handleBringUpReady} />;
    }
    if (prep) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-zinc-100">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border border-zinc-500 border-t-transparent" />
          <p data-testid="native-prep" className="text-sm text-zinc-400">
            {prep}
          </p>
        </main>
      );
    }
    return <HealthGate health={health} target={screen.target} />;
  }

  return (
    <>
      <ConnectionPicker
        hardware={hardware}
        profiles={profiles}
        stackUp={stackUp}
        onConnectLocal={connectLocal}
        onRestartStack={handleRestart}
        onConnectSsh={connect}
        onAddMachine={() => setScreen({ name: "editor" })}
        onEditProfile={(profile) => setScreen({ name: "editor", profile })}
        onDeleteProfile={handleDelete}
      />
      {(error || keychainWarning) && (
        <p className="fixed inset-x-0 bottom-4 mx-auto max-w-md rounded-md bg-zinc-900 px-4 py-2 text-center text-xs text-amber-400">
          {error ?? keychainWarning}
        </p>
      )}
    </>
  );
}

export default App;
