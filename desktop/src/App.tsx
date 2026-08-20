// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";
import BringUpProgress from "./views/BringUpProgress";
import ConnectErrorCard from "./views/ConnectErrorCard";
import CloseBehaviorSetting from "./views/CloseBehaviorSetting";
import ConnectionPicker from "./views/ConnectionPicker";
import LogsViewer from "./views/LogsViewer";
import ProfileEditor from "./views/ProfileEditor";
import QuitDialog from "./views/QuitDialog";
import {
  StackSwitchProgress,
  StackUpdatePrompt,
} from "./views/StackUpdateCard";
import StackUpdateSetting from "./views/StackUpdateSetting";
import UpdateBanner from "./views/UpdateBanner";
import { stackSkipNotice } from "./lib/updates";
import {
  describeSshError,
  TrustHostKeyDialog,
  TunnelBanner,
} from "./views/TunnelBanner";
import {
  blockedPorts,
  classificationCard,
  describeStep,
  portConflictCard,
  type ConnectErrorInfo,
  type ConnectStep,
} from "./lib/connect";
import {
  applyExit,
  initialBringUpState,
  parseEventLine,
  reduceEvent,
  type BringUpState,
} from "./lib/events";
import {
  asSecretError,
  asSshError,
  cancelRemoteBringUp,
  checkStackFreshness,
  checkStackHealth,
  classifyRemoteStack,
  createBugReport,
  deleteProfile,
  detectHardware,
  getActiveRemote,
  listProfiles,
  markLocalAttach,
  markProfileUsed,
  onBringUpExit,
  onBringUpLine,
  onRemoteStopLine,
  onStackHealth,
  onSwitchLine,
  onTunnelStatus,
  openStack,
  quitApp,
  resolveStackCheckout,
  restartStack,
  runStackSwitch,
  saveProfile,
  setSshKeyPassphrase,
  startBringUp,
  stopBringUp,
  startHealthPoll,
  startRemoteBringUp,
  startSshTunnels,
  stopHealthPoll,
  stopSshTunnels,
  trustHostKey,
  type HardwareProbe,
  type Profile,
  type StackHealth,
  type TunnelStatus,
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
  | { name: "connecting"; target: Profile | null; bringUpOnly?: boolean }
  | { name: "logs" }
  | { name: "quit" };

/**
 * Where an SSH connect currently is. Local connects skip this entirely
 * ("attach" from the start); SSH connects walk tunnel → classify →
 * bringup-or-attach, or park on an error card.
 */
type RemoteStage =
  | { step: ConnectStep }
  | { step: "error"; card: ConnectErrorInfo };

const STATUS_STYLE: Record<string, string> = {
  up: "bg-emerald-500",
  down: "bg-red-500",
  unreachable: "bg-zinc-600",
};

/** Per-service health checklist shown while waiting for the stack. */
function HealthGate({
  health,
  target,
  tunnel,
  activity,
  onCancel,
}: {
  health: StackHealth | null;
  target: Profile | null;
  tunnel: TunnelStatus | null;
  activity?: string;
  onCancel?: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-zinc-100">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {target ? `Connecting to ${target.name}` : "Starting TT-Studio"}
        </h1>
        <p className="mt-1 text-sm text-zinc-400" data-testid="connect-activity">
          {health?.ready
            ? "All services are up — opening TT-Studio…"
            : (activity ?? "Waiting for all services to come up")}
        </p>
      </header>
      {target && <TunnelBanner status={tunnel} />}
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
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          data-testid="connect-cancel"
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          Cancel
        </button>
      )}
    </main>
  );
}

function App() {
  // The Rust side intercepts the window close while an SSH connection is
  // active and navigates here with ?quit=1 — the launcher then owns the
  // stop-vs-disconnect decision (the stack page itself has no Tauri IPC).
  const [screen, setScreen] = useState<Screen>(() =>
    new URLSearchParams(window.location.search).has("quit")
      ? { name: "quit" }
      : { name: "loading" },
  );
  const [hardware, setHardware] = useState<HardwareProbe | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [health, setHealth] = useState<StackHealth | null>(null);
  const [bringUp, setBringUp] = useState<BringUpState | null>(null);
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [stage, setStage] = useState<RemoteStage>({ step: "tunnel" });
  const [keychainWarning, setKeychainWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** One-line status while native mode prepares (checkout clone, --stop). */
  const [prep, setPrep] = useState<string | null>(null);
  /** Whether a local stack already answers its health checks (picker info). */
  const [stackUp, setStackUp] = useState(false);
  /** Why the stack update was skipped this connect (info line, not an error). */
  const [stackNotice, setStackNotice] = useState<string | null>(null);
  /** Freshness said "behind" and policy is prompt — waiting on the user. */
  const [pendingUpdate, setPendingUpdate] = useState<{
    target: Profile | null;
    from: string;
    to: string;
  } | null>(null);
  /** A `run.py --switch` is running; lines stream into the progress card. */
  const [switching, setSwitching] = useState<{
    to: string;
    lines: string[];
  } | null>(null);
  const opening = useRef(false);

  /** Kick off the actual bring-up on the target (after any update handling). */
  const continueBringUp = useCallback(async (target: Profile | null) => {
    if (target) {
      await startRemoteBringUp(target);
      setStage({ step: "bringup" });
      return;
    }
    setPrep("Preparing the TT-Studio checkout (first run clones it)…");
    try {
      const checkout = await resolveStackCheckout();
      await startBringUp(checkout.path);
    } finally {
      setPrep(null);
    }
  }, []);

  /**
   * Run `run.py --switch` with a streamed progress card. A failed switch
   * (including the dirty-tree refusal) becomes an info line — bring-up
   * continues on the current version.
   */
  const runSwitch = useCallback(async (target: Profile | null, to: string) => {
    setSwitching({ to, lines: [] });
    const unlisten = await onSwitchLine((line) =>
      setSwitching(
        (prev) => prev && { ...prev, lines: [...prev.lines.slice(-199), line] },
      ),
    );
    try {
      await runStackSwitch(target, to);
    } catch (e) {
      setStackNotice(
        `Stack update to ${to} failed — continuing on the current version. ${e}`,
      );
    } finally {
      unlisten();
      setSwitching(null);
    }
  }, []);

  // The freshness gate before every bring-up: maybe switch the checkout to
  // the latest release first. Never blocks connecting — every failure or
  // skip falls through to bring-up, at most with an info line.
  const maybeUpdateThenBringUp = useCallback(
    async (target: Profile | null) => {
      let fresh = null;
      try {
        fresh = await checkStackFreshness(target);
      } catch (e) {
        setStackNotice(`Couldn't check for stack updates — continuing. ${e}`);
      }
      if (fresh?.action === "ask") {
        setPendingUpdate({ target, from: fresh.from, to: fresh.to });
        return;
      }
      if (fresh?.action === "update") {
        await runSwitch(target, fresh.to);
      } else if (fresh?.action === "skip") {
        setStackNotice(stackSkipNotice(fresh.reason));
      }
      await continueBringUp(target);
    },
    [continueBringUp, runSwitch],
  );

  useEffect(() => {
    if (screen.name === "quit") return;
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
  // For SSH targets the poll waits for the attach stage — before the tunnel
  // is verified, localhost:3000 could be some other local server.
  useEffect(() => {
    if (screen.name !== "connecting" || screen.bringUpOnly) return;
    if (screen.target && stage.step !== "attach") return;
    let unlisten: (() => void) | undefined;
    onStackHealth(setHealth).then((fn) => {
      unlisten = fn;
    });
    startHealthPoll().catch((e) => setError(String(e)));
    return () => {
      unlisten?.();
      stopHealthPoll().catch(() => {});
    };
  }, [screen, stage.step]);

  // Tunnel established for an SSH target: first make sure every essential
  // local port actually bound (a taken port 3000 must become an error card,
  // never a silent remap), then ask the remote side whether to attach to a
  // running stack or bring one up.
  useEffect(() => {
    if (
      screen.name !== "connecting" ||
      !screen.target ||
      stage.step !== "tunnel" ||
      tunnel?.phase.state !== "connected"
    )
      return;
    const target = screen.target;
    const blocked = blockedPorts(tunnel);
    if (blocked.length > 0) {
      stopSshTunnels().catch(() => {});
      setStage({ step: "error", card: portConflictCard(blocked) });
      return;
    }
    setStage({ step: "classify" });
    classifyRemoteStack(target)
      .then((classification) => {
        if (classification.kind === "healthy") {
          setStage({ step: "attach" });
          return;
        }
        const card = classificationCard(classification, target);
        if (card) {
          setStage({ step: "error", card });
          return;
        }
        return maybeUpdateThenBringUp(target);
      })
      .catch((e) => {
        const ssh = asSshError(e);
        setStage({
          step: "error",
          card: {
            title: `Couldn't inspect the stack on ${target.name}`,
            body: ssh ? describeSshError(ssh) : String(e),
          },
        });
      });
  }, [screen, stage.step, tunnel, maybeUpdateThenBringUp]);

  // For SSH targets: follow tunnel status. The listener is scoped to the
  // connecting screen, but the tunnel itself keeps running after we navigate
  // to the stack — it IS the transport to the remote services.
  useEffect(() => {
    if (screen.name !== "connecting" || !screen.target) return;
    let unlisten: (() => void) | undefined;
    onTunnelStatus(setTunnel).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [screen]);

  // Hard tunnel loss (not the trust prompt) while still on the launcher:
  // stop the supervisor and drop back to the picker with the reason.
  useEffect(() => {
    if (screen.name !== "connecting" || tunnel?.phase.state !== "lost") return;
    if (tunnel.phase.error.code === "unknown_host_key") return;
    const message = describeSshError(tunnel.phase.error);
    stopSshTunnels().catch(() => {});
    setTunnel(null);
    setError(message);
    setScreen({ name: "picker" });
  }, [screen.name, tunnel]);

  // When a bring-up is running (`python run.py --json-events`, native or
  // over ssh exec), render its NDJSON stream natively instead of the bare
  // checklist.
  useEffect(() => {
    if (screen.name !== "connecting") return;
    let unlistenLine: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    onBringUpLine((line) => {
      const event = parseEventLine(line);
      if (!event) return;
      setBringUp((prev) => reduceEvent(prev ?? initialBringUpState(), event));
    }).then((fn) => {
      unlistenLine = fn;
    });
    // A bring-up that dies without a terminal event (crash, kill, network
    // drop, blocked prompt before the stream existed) still needs an error
    // card — synthesize one from the exit notification instead of spinning.
    onBringUpExit((exit) => {
      setBringUp((prev) => {
        const state = prev ?? initialBringUpState();
        if (!exit.error) return applyExit(state, exit.exit_code);
        if (state.ready || state.errors.length > 0) return state;
        return reduceEvent(state, {
          v: 1,
          ts: 0,
          event: "error",
          phase: null,
          detail: {
            message: exit.error,
            remediation:
              "Check remote-bringup.log in the app's log folder, then try connecting again.",
          },
        });
      });
    }).then((fn) => {
      unlistenExit = fn;
    });
    return () => {
      unlistenLine?.();
      unlistenExit?.();
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
    setTunnel(null);
    setError(null);
    setStackNotice(null);
    // Local connects go straight to the health gate; SSH connects walk the
    // tunnel → classify → attach-or-bringup stages first.
    setStage({ step: target ? "tunnel" : "attach" });
    opening.current = false;
    if (target) {
      markProfileUsed(target.id).catch(() => {});
      startSshTunnels(target).catch((e) => setError(String(e)));
    }
    setScreen({ name: "connecting", target });
  }, []);

  const handleUpdateNow = useCallback(() => {
    if (!pendingUpdate) return;
    const { target, to } = pendingUpdate;
    setPendingUpdate(null);
    runSwitch(target, to)
      .then(() => continueBringUp(target))
      .catch((e) => {
        setError(String(e));
        setScreen({ name: "picker" });
      });
  }, [pendingUpdate, runSwitch, continueBringUp]);

  const handleUpdateSkip = useCallback(() => {
    if (!pendingUpdate) return;
    const target = pendingUpdate.target;
    setPendingUpdate(null);
    continueBringUp(target).catch((e) => {
      setError(String(e));
      setScreen({ name: "picker" });
    });
  }, [pendingUpdate, continueBringUp]);

  // Native mode: attach if the stack is already healthy, otherwise resolve
  // the checkout (cloning on first use), maybe refresh it, and spawn the
  // bring-up.
  const connectLocal = useCallback(async () => {
    setHealth(null);
    setStage({ step: "attach" });
    setStackNotice(null);
    opening.current = false;
    setScreen({ name: "connecting", target: null });
    try {
      const current = await checkStackHealth();
      if (current.ready) {
        // Already running: no bring-up (and no update — never switch the
        // checkout under a live stack); the health poller opens the stack.
        await markLocalAttach();
        return;
      }
      await maybeUpdateThenBringUp(null);
    } catch (e) {
      setError(String(e));
      setScreen({ name: "picker" });
    }
  }, [maybeUpdateThenBringUp]);

  // Explicit "Restart stack": run.py --stop, then a fresh bring-up. Health
  // polling is suppressed (bringUpOnly) so the old, still-draining services
  // can't re-open the stack mid-restart.
  const handleRestart = useCallback(async () => {
    setHealth(null);
    setStage({ step: "attach" });
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

  // ---- quit dialog state (screen "quit" only) ----
  const [quitTarget, setQuitTarget] = useState<Profile | null>(null);
  const [quitStopping, setQuitStopping] = useState(false);
  const [quitStopLines, setQuitStopLines] = useState<string[]>([]);
  const [quitError, setQuitError] = useState<string | null>(null);

  useEffect(() => {
    if (screen.name !== "quit") return;
    getActiveRemote()
      .then(setQuitTarget)
      .catch(() => setQuitTarget(null));
    let unlisten: (() => void) | undefined;
    onRemoteStopLine((line) =>
      setQuitStopLines((prev) => [...prev, line]),
    ).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [screen.name]);

  const handleStopAndQuit = useCallback(() => {
    setQuitStopping(true);
    setQuitError(null);
    setQuitStopLines([]);
    // On success the app exits before this promise settles visibly; only
    // the failure path matters here.
    quitApp(true).catch((e) => {
      setQuitStopping(false);
      const ssh = asSshError(e);
      setQuitError(ssh ? describeSshError(ssh) : String(e));
    });
  }, []);

  const handleDisconnectQuit = useCallback(() => {
    quitApp(false).catch((e) => setQuitError(String(e)));
  }, []);

  const handleQuitCancel = useCallback(() => {
    openStack(STACK_URL).catch((e) => setQuitError(String(e)));
  }, []);

  /** Tear down whatever the connect flow has started and go back. */
  const cancelConnect = useCallback(() => {
    stopBringUp().catch(() => {});
    cancelRemoteBringUp().catch(() => {});
    stopSshTunnels().catch(() => {});
    setTunnel(null);
    setHealth(null);
    setPendingUpdate(null);
    setSwitching(null);
    setStackNotice(null);
    setScreen({ name: "picker" });
  }, []);

  const handleTrustHostKey = useCallback(
    (target: Profile) => {
      const phase = tunnel?.phase;
      if (phase?.state !== "lost" || phase.error.code !== "unknown_host_key")
        return;
      const { host, port, public_key } = phase.error;
      setTunnel(null);
      trustHostKey(host ?? "", port ?? 22, public_key ?? "")
        .then(() => startSshTunnels(target))
        .catch((e) => {
          setError(String(e));
          setScreen({ name: "picker" });
        });
    },
    [tunnel],
  );

  const handleRejectHostKey = useCallback(() => {
    stopSshTunnels().catch(() => {});
    setTunnel(null);
    setScreen({ name: "picker" });
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

  /** Collecting a diagnostics bundle (picker footer action). */
  const [bugReportBusy, setBugReportBusy] = useState(false);

  // Collect on whatever this session is connected to: the active SSH
  // profile if there is one, otherwise the local checkout.
  const handleBugReport = useCallback(async () => {
    setBugReportBusy(true);
    setError(null);
    try {
      const remote = await getActiveRemote().catch(() => null);
      const result = await createBugReport(remote);
      setError(
        `Diagnostics bundle ready (${result.reference ?? "no id"}) — ${result.path}`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBugReportBusy(false);
    }
  }, []);

  const handleDelete = useCallback(async (profile: Profile) => {
    try {
      setProfiles(await deleteProfile(profile.id));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  if (screen.name === "quit") {
    return (
      <QuitDialog
        machine={quitTarget?.name ?? null}
        stopping={quitStopping}
        lines={quitStopLines}
        error={quitError}
        onStopAndQuit={handleStopAndQuit}
        onDisconnectQuit={handleDisconnectQuit}
        onCancel={handleQuitCancel}
      />
    );
  }

  if (screen.name === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Loading…
      </main>
    );
  }

  if (screen.name === "logs") {
    return <LogsViewer onBack={() => setScreen({ name: "picker" })} />;
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
    const target = screen.target;
    if (
      target &&
      tunnel?.phase.state === "lost" &&
      tunnel.phase.error.code === "unknown_host_key"
    ) {
      return (
        <TrustHostKeyDialog
          error={tunnel.phase.error}
          onTrust={() => handleTrustHostKey(target)}
          onReject={handleRejectHostKey}
        />
      );
    }
    if (target && stage.step === "error") {
      return (
        <ConnectErrorCard
          card={stage.card}
          onBack={cancelConnect}
          onEdit={() => {
            stopSshTunnels().catch(() => {});
            setTunnel(null);
            setScreen({ name: "editor", profile: target });
          }}
        />
      );
    }
    if (pendingUpdate) {
      return (
        <StackUpdatePrompt
          from={pendingUpdate.from}
          to={pendingUpdate.to}
          machine={target?.name ?? null}
          onUpdate={handleUpdateNow}
          onSkip={handleUpdateSkip}
        />
      );
    }
    if (switching) {
      return <StackSwitchProgress to={switching.to} lines={switching.lines} />;
    }
    const notice = stackNotice && (
      <p
        data-testid="stack-notice"
        className="fixed inset-x-0 bottom-4 mx-auto max-w-md rounded-md bg-zinc-900 px-4 py-2 text-center text-xs text-zinc-400"
      >
        {stackNotice}
      </p>
    );
    if (
      bringUp &&
      (bringUp.phases.length > 0 ||
        bringUp.errors.length > 0 ||
        bringUp.promptBlocked)
    ) {
      return (
        <>
          <BringUpProgress
            state={bringUp}
            onReady={handleBringUpReady}
            onCancel={cancelConnect}
          />
          {notice}
        </>
      );
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
    return (
      <>
        <HealthGate
          health={health}
          target={target}
          tunnel={tunnel}
          activity={
            target && stage.step !== "error"
              ? describeStep(stage.step, target.name)
              : undefined
          }
          onCancel={cancelConnect}
        />
        {notice}
      </>
    );
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
      <div className="fixed bottom-4 left-4 flex items-center gap-4">
        <UpdateBanner />
        <StackUpdateSetting />
        <CloseBehaviorSetting />
        <button
          type="button"
          data-testid="open-logs"
          onClick={() => setScreen({ name: "logs" })}
          className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
        >
          Logs
        </button>
        <button
          type="button"
          data-testid="report-bug"
          onClick={handleBugReport}
          disabled={bugReportBusy}
          className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline disabled:opacity-50"
        >
          {bugReportBusy ? "Collecting diagnostics…" : "Report a bug"}
        </button>
      </div>
      {(error || keychainWarning) && (
        <p className="fixed inset-x-0 bottom-4 mx-auto max-w-md rounded-md bg-zinc-900 px-4 py-2 text-center text-xs text-amber-400">
          {error ?? keychainWarning}
        </p>
      )}
    </>
  );
}

export default App;
