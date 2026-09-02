// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";
import BringUpProgress from "./views/BringUpProgress";
import ConnectErrorCard from "./views/ConnectErrorCard";
import CloseBehaviorSetting from "./views/CloseBehaviorSetting";
import ResumeGate from "./views/ResumeGate";
import ResumeSetting from "./views/ResumeSetting";
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
  describeSessionAge,
  portClearNotice,
  resumeBlockedNotice,
  resumeNotReadyNotice,
} from "./lib/session";
import {
  blockedPorts,
  classificationCard,
  describeStep,
  freedNotice,
  portClearCard,
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
  adoptDetectedHost,
  cancelQuit,
  detectSshHosts,
  openTerms,
  prepareLocalPorts,
  clearLastSession,
  suppressResume,
  takeResumeTarget,
  getSessionInfo,
  setCloseBehavior,
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
  type ClearReport,
  type CloseBehavior,
  type DetectedHost,
  type ResumePlan,
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
  // resume: this connect started itself on launch, so it must stay
  // cancellable, never prompt for trust, and never bring a stack up.
  | {
      name: "connecting";
      target: Profile | null;
      bringUpOnly?: boolean;
      resume?: boolean;
    }
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
  const [detected, setDetected] = useState<DetectedHost[]>([]);
  /** What the last connect freed on this computer, for the notice. */
  const [freed, setFreed] = useState<ClearReport | null>(null);
  /** The resume this launch started, for the gate's wording. */
  const [resumePlan, setResumePlan] = useState<ResumePlan | null>(null);

  /**
   * Give up on an automatic resume and hand the user the picker.
   *
   * Clears the stored record so the next launch starts clean rather than
   * re-attempting whatever just failed, and leaves a line saying why — a
   * resume that silently evaporates looks like the app ignored the machine.
   */
  const abandonResume = useCallback((why: string | null) => {
    clearLastSession().catch(() => {});
    stopSshTunnels().catch(() => {});
    setResumePlan(null);
    setTunnel(null);
    setHealth(null);
    if (why) setStackNotice(why);
    setScreen({ name: "picker" });
  }, []);
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
    // takeResumeTarget consumes this process's one resume attempt, so the
    // launcher re-mounting (quit prompt, tunnel-loss return, "Switch
    // machine") can never start a second one.
    Promise.all([detectHardware(), listProfiles(), takeResumeTarget()])
      .then(([hw, saved, plan]) => {
        setHardware(hw);
        setProfiles(saved);
        if (plan) {
          setResumePlan(plan);
          connect(plan.profile, true);
          return;
        }
        setScreen({ name: "picker" });
      })
      .catch((e) => {
        setError(String(e));
        setScreen({ name: "picker" });
      });
    // connect is stable (useCallback with no deps) and this must run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On the picker, take one health snapshot so it can say whether a local
  // stack is already running (read-only GETs).
  useEffect(() => {
    if (screen.name !== "picker") return;
    checkStackHealth()
      .then((h) => setStackUp(h.ready))
      .catch(() => setStackUp(false));
  }, [screen.name]);

  // Machines from ~/.ssh/config. Deliberately its own effect rather than part
  // of the startup Promise.all: it shells out once per alias, and a slow scan
  // must never hold up the picker.
  useEffect(() => {
    if (screen.name !== "picker") return;
    detectSshHosts()
      .then((result) => setDetected(result.hosts))
      .catch(() => setDetected([]));
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
    const resuming = screen.resume === true;
    const blocked = blockedPorts(tunnel);
    if (blocked.length > 0) {
      stopSshTunnels().catch(() => {});
      if (resuming) {
        abandonResume(resumeBlockedNotice(target.name, blocked));
        return;
      }
      setStage({ step: "error", card: portConflictCard(blocked) });
      return;
    }
    setStage({ step: "classify" });
    // Resuming: the forwards are verified, so one local health check answers
    // the only question a resume asks. `classify` short-circuits on the same
    // signal anyway (remote.rs), but reaching it costs a second SSH session.
    const decide = resuming
      ? checkStackHealth().then((health) =>
          health.ready
            ? ({ kind: "healthy" } as const)
            : classifyRemoteStack(target),
        )
      : classifyRemoteStack(target);
    decide
      .then((classification) => {
        if (classification.kind === "healthy") {
          setStage({ step: "attach" });
          return;
        }
        // A resume never mutates the remote machine: bringing a stack up on a
        // shared box claims hardware for minutes, and that must be someone's
        // decision, not a side effect of opening an app.
        if (resuming) {
          abandonResume(resumeNotReadyNotice(target.name, classification));
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
        if (resuming) {
          abandonResume(
            `Couldn't reconnect to ${target.name}: ${ssh ? describeSshError(ssh) : String(e)}`,
          );
          return;
        }
        setStage({
          step: "error",
          card: {
            title: `Couldn't inspect the stack on ${target.name}`,
            body: ssh ? describeSshError(ssh) : String(e),
          },
        });
      });
  }, [screen, stage.step, tunnel, maybeUpdateThenBringUp, abandonResume]);

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
    const resuming = screen.resume === true;
    // An unknown host key is a trust decision, and a trust decision must
    // always attach to something the user deliberately did. On a resume it is
    // also the more suspicious case — we have reached this host before, so a
    // new key means known_hosts was lost or the host changed. Drop to the
    // picker; a manual connect gets the normal prompt.
    if (tunnel.phase.error.code === "unknown_host_key" && !resuming) return;
    const message = describeSshError(tunnel.phase.error);
    if (resuming) {
      abandonResume(
        `Couldn't reconnect to ${screen.target?.name ?? "the last machine"}: ${message}`,
      );
      return;
    }
    stopSshTunnels().catch(() => {});
    setTunnel(null);
    setError(message);
    setScreen({ name: "picker" });
  }, [screen, tunnel, abandonResume]);

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
      setBringUp((prev) =>
        // applyExit owns the exit-code-vs-stderr judgement (events.ts): a
        // usage error and a blocked prompt both exit 2, and only the message
        // tells them apart.
        applyExit(prev ?? initialBringUpState(), exit.exit_code, exit.error),
      );
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

  const connect = useCallback((target: Profile | null, resume = false) => {
    setHealth(null);
    setTunnel(null);
    setError(null);
    setStackNotice(null);
    setFreed(null);
    // Local connects go straight to the health gate; SSH connects clear the
    // local ports, then walk tunnel → classify → attach-or-bringup.
    setStage({ step: target ? "ports" : "attach" });
    opening.current = false;
    setScreen({ name: "connecting", target, resume });
    if (!target) return;
    markProfileUsed(target.id).catch(() => {});
    // Pre-flight before the tunnel exists: nothing to tear down if a port is
    // unavailable, and exactly one clear attempt per connect by construction.
    prepareLocalPorts()
      .catch(() => null)
      .then((report) => {
        if (report && report.skipped.length > 0) {
          if (resume) {
            abandonResume(portClearNotice(report));
            return;
          }
          setStage({ step: "error", card: portClearCard(report) });
          return;
        }
        if (report) setFreed(report);
        setStage({ step: "tunnel" });
        startSshTunnels(target).catch((e) => setError(String(e)));
      });
  }, [abandonResume]);

  /**
   * The user agreed to the OS Model Terms in the app: re-run the bring-up
   * with `--accept-terms` so the launcher's first-run gate passes. Only ever
   * reached from an explicit click — the app never answers it for them.
   */
  const acceptTermsAndRetry = useCallback((target: Profile | null) => {
    setBringUp(null);
    if (target) {
      startRemoteBringUp(target, true).catch((e) => setError(String(e)));
      return;
    }
    resolveStackCheckout()
      .then((checkout) => startBringUp(checkout.path, true))
      .catch((e) => setError(String(e)));
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
  const [quitHealth, setQuitHealth] = useState<StackHealth | null>(null);
  const [quitSessionAge, setQuitSessionAge] = useState<number | null>(null);
  const [quitRemember, setQuitRemember] = useState(false);

  useEffect(() => {
    if (screen.name !== "quit") return;
    getActiveRemote()
      .then(setQuitTarget)
      .catch(() => setQuitTarget(null));
    // The health poller stopped when we navigated to the stack, so take one
    // snapshot for the dialog. It fills in late and blocks nothing.
    checkStackHealth()
      .then(setQuitHealth)
      .catch(() => setQuitHealth(null));
    getSessionInfo()
      .then((info) => setQuitSessionAge(info.age_secs))
      .catch(() => setQuitSessionAge(null));
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

  /**
   * Persist the remembered close preference *before* quitting: quit_app
   * exits the process, so a fire-and-forget store write can be lost.
   */
  const rememberChoice = useCallback(
    async (behavior: CloseBehavior) => {
      if (!quitRemember) return;
      await setCloseBehavior(behavior).catch(() => {});
    },
    [quitRemember],
  );

  const handleStopAndQuit = useCallback(async () => {
    setQuitStopping(true);
    setQuitError(null);
    setQuitStopLines([]);
    await rememberChoice("stop_stack");
    // On success the app exits before this promise settles visibly; only
    // the failure path matters here.
    quitApp(true).catch((e) => {
      setQuitStopping(false);
      const ssh = asSshError(e);
      setQuitError(ssh ? describeSshError(ssh) : String(e));
    });
  }, [rememberChoice]);

  const handleDisconnectQuit = useCallback(async () => {
    await rememberChoice("keep_running");
    quitApp(false).catch((e) => setQuitError(String(e)));
  }, [rememberChoice]);

  const handleQuitCancel = useCallback(() => {
    // Backing out must release the quit latch, or the next close request
    // would be swallowed as "a prompt is already showing".
    cancelQuit()
      .catch(() => {})
      .finally(() => {
        openStack(STACK_URL).catch((e) => setQuitError(String(e)));
      });
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

  /**
   * Adopt a detected host into a real profile, then connect to it. The scan
   * result is ephemeral on purpose — profiles.json only gains a row when
   * someone actually uses the machine.
   */
  const connectDetected = useCallback(
    async (host: DetectedHost) => {
      try {
        const profile = await adoptDetectedHost(host);
        setProfiles(await listProfiles());
        connect(profile);
      } catch (e) {
        setError(String(e));
      }
    },
    [connect],
  );

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
        sessionAge={describeSessionAge(quitSessionAge)}
        health={quitHealth}
        remember={quitRemember}
        onRememberChange={setQuitRemember}
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
    // An automatic resume gets its own screen: the same stages underneath,
    // but framed as something the app started, with both exits in reach.
    if (target && screen.resume && stage.step !== "attach") {
      return (
        <ResumeGate
          machine={target.name}
          age={describeSessionAge(resumePlan?.age_secs ?? null)}
          activity={
            stage.step === "error"
              ? stage.card.title
              : describeStep(stage.step, target.name)
          }
          onCancel={() => {
            suppressResume().catch(() => {});
            cancelConnect();
          }}
          onPickAnother={() => {
            suppressResume().catch(() => {});
            cancelConnect();
          }}
        />
      );
    }
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
    // One slot, stacked: the stack notice and the freed-ports notice used to
    // occupy the same fixed position and cover each other.
    const freedLine = freedNotice(
      freed ?? { freed: [], skipped: [] },
      screen.target?.name,
    );
    const notice = (stackNotice || freedLine) && (
      <div className="fixed inset-x-0 bottom-4 mx-auto flex max-w-md flex-col items-center gap-2 px-4">
        {freedLine && (
          <p
            data-testid="freed-notice"
            className="w-full rounded-md border border-amber-900 bg-amber-950/40 px-4 py-2 text-center text-xs text-amber-200/90"
          >
            {freedLine}
          </p>
        )}
        {stackNotice && (
          <p
            data-testid="stack-notice"
            className="w-full rounded-md bg-zinc-900 px-4 py-2 text-center text-xs text-zinc-400"
          >
            {stackNotice}
          </p>
        )}
      </div>
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
            machine={
              target && {
                host: target.host,
                user: target.user,
                repoPath: target.remote_repo_path,
              }
            }
            onAcceptTerms={() => acceptTermsAndRetry(target)}
            onOpenTerms={() => {
              openTerms().catch((e) => setError(String(e)));
            }}
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
        detected={detected}
        onConnectDetected={connectDetected}
        onAddMachine={() => setScreen({ name: "editor" })}
        onEditProfile={(profile) => setScreen({ name: "editor", profile })}
        onDeleteProfile={handleDelete}
      />
      <div className="fixed bottom-4 left-4 flex items-center gap-4">
        <UpdateBanner />
        <StackUpdateSetting />
        <CloseBehaviorSetting />
        <ResumeSetting />
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
