// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Typed wrappers around the Tauri IPC surface exposed by src-tauri. Keep the
// shapes in sync with the Rust structs (profiles.rs, hardware.rs, health.rs,
// secrets.rs) — serde uses snake_case throughout.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ProfileKind = "local" | "ssh";

export type SshAuth = { method: "agent" } | { method: "key"; path: string };

export interface Profile {
  id: string;
  name: string;
  kind: ProfileKind;
  host?: string;
  port?: number;
  user?: string;
  auth?: SshAuth;
  remote_repo_path?: string;
  last_used?: number;
}

export type Platform = "linux" | "macos" | "windows" | "other";

export interface HardwareProbe {
  platform: Platform;
  accelerator_present: boolean;
  default_mode: ProfileKind;
}

export type ServiceStatus = "up" | "down" | "unreachable";

export interface ServiceHealth {
  name: string;
  url: string;
  status: ServiceStatus;
}

export interface StackHealth {
  services: ServiceHealth[];
  ready: boolean;
}

export interface SecretError {
  code: "keychain_unavailable" | "not_found" | "other";
  message?: string;
}

// ---- profiles ----

export const listProfiles = () => invoke<Profile[]>("list_profiles");

export const saveProfile = (profile: Profile) =>
  invoke<Profile[]>("save_profile", { profile });

export const deleteProfile = (id: string) =>
  invoke<Profile[]>("delete_profile", { id });

export const markProfileUsed = (id: string) =>
  invoke<void>("mark_profile_used", { id });

// ---- secrets (write-only from the UI; reads stay in Rust) ----

export const setSshKeyPassphrase = (profileId: string, passphrase: string) =>
  invoke<void>("set_ssh_key_passphrase", { profileId, passphrase });

export const clearSshKeyPassphrase = (profileId: string) =>
  invoke<void>("clear_ssh_key_passphrase", { profileId });

export const hasSshKeyPassphrase = (profileId: string) =>
  invoke<boolean>("has_ssh_key_passphrase", { profileId });

/** Narrow an unknown invoke() rejection into a SecretError when possible. */
export function asSecretError(e: unknown): SecretError | null {
  if (typeof e === "object" && e !== null && "code" in e) {
    return e as SecretError;
  }
  return null;
}

// ---- hardware & health ----

export const detectHardware = () => invoke<HardwareProbe>("detect_hardware");

export const checkStackHealth = () =>
  invoke<StackHealth>("check_stack_health");

export const startHealthPoll = () => invoke<void>("start_health_poll");

export const stopHealthPoll = () => invoke<void>("stop_health_poll");

export const onStackHealth = (
  handler: (health: StackHealth) => void,
): Promise<UnlistenFn> =>
  listen<StackHealth>("stack-health", (event) => handler(event.payload));

// ---- ssh tunnels ----

export interface SshErrorPayload {
  code:
    | "dns"
    | "refused"
    | "timeout"
    | "handshake"
    | "agent_unavailable"
    | "key_file"
    | "auth_failed"
    | "unknown_host_key"
    | "changed_host_key"
    | "known_hosts"
    | "disconnected"
    | "internal";
  message?: string;
  host?: string;
  port?: number;
  path?: string;
  key_type?: string;
  fingerprint?: string;
  public_key?: string;
}

export type TunnelPhase =
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "reconnecting"; attempt: number; next_delay_secs: number }
  | { state: "lost"; error: SshErrorPayload };

/** The process holding a local port the tunnel wanted (ssh/tunnel.rs). */
export interface PortHolder {
  pid: number;
  name: string;
}

export interface ForwardHealth {
  local_port: number;
  remote_port: number;
  active: boolean;
  last_error?: string;
  /** Set only when the bind failed because something else holds the port. */
  holder?: PortHolder | null;
}

export interface TunnelStatus {
  phase: TunnelPhase;
  forwards: ForwardHealth[];
}

export const startSshTunnels = (profile: Profile) =>
  invoke<void>("start_ssh_tunnels", { profile });

export const stopSshTunnels = () => invoke<void>("stop_ssh_tunnels");

export const getTunnelStatus = () =>
  invoke<TunnelStatus | null>("get_tunnel_status");

export const trustHostKey = (host: string, port: number, publicKey: string) =>
  invoke<void>("trust_host_key", { host, port, publicKey });

export const onTunnelStatus = (
  handler: (status: TunnelStatus) => void,
): Promise<UnlistenFn> =>
  listen<TunnelStatus>("tunnel-status", (event) => handler(event.payload));

// ---- remote stack detection & bring-up (remote.rs) ----

export type StackClassification =
  | { kind: "healthy" }
  | { kind: "partial"; healthy: string[]; unhealthy: string[] }
  | { kind: "down" }
  | { kind: "no_checkout"; path: string }
  | { kind: "python_missing"; message: string }
  | { kind: "python_too_old"; found: string; required: string };

export interface BringUpExit {
  exit_code: number | null;
  error?: string;
}

export const classifyRemoteStack = (profile: Profile) =>
  invoke<StackClassification>("classify_remote_stack", { profile });

/**
 * `acceptTerms` passes the launcher's `--accept-terms`. Only ever true after
 * the user agreed in the app — see BringUpProgress's terms card.
 */
export const startRemoteBringUp = (profile: Profile, acceptTerms = false) =>
  invoke<void>("start_remote_bring_up", { profile, acceptTerms });

export const cancelRemoteBringUp = () =>
  invoke<void>("cancel_remote_bring_up");

// ---- native launcher (stack checkout + run.py child) ----

export interface StackCheckout {
  path: string;
  source: "configured" | "managed" | "cloned";
}

/** May shallow-clone the latest release on first use — can take a while. */
export const resolveStackCheckout = () =>
  invoke<StackCheckout>("resolve_stack_checkout");

export const setStackCheckoutPath = (path: string | null) =>
  invoke<void>("set_stack_checkout_path", { path });

export const startBringUp = (checkout: string, acceptTerms = false) =>
  invoke<number>("start_bring_up", { checkout, acceptTerms });

export const stopBringUp = () => invoke<boolean>("stop_bring_up");

export const bringUpRunning = () => invoke<boolean>("bring_up_running");

/** Record that the UI attached to an already-running local stack. */
export const markLocalAttach = () => invoke<void>("mark_local_attach");

/** `run.py --stop`, then a fresh bring-up. Explicit user action only. */
export const restartStack = (checkout: string) =>
  invoke<number>("restart_stack", { checkout });

/** Raw NDJSON lines from `run.py --json-events`, native or over ssh exec
 * (parse with lib/events.ts). */
export const onBringUpLine = (
  handler: (line: string) => void,
): Promise<UnlistenFn> =>
  listen<string>("bringup-line", (event) => handler(event.payload));

/** Fired once when a bring-up (native child or remote exec) finishes. */
export const onBringUpExit = (
  handler: (exit: BringUpExit) => void,
): Promise<UnlistenFn> =>
  listen<BringUpExit>("bringup-exit", (event) => handler(event.payload));

// ---- quitting (optionally stopping the remote stack first) ----

/** The profile the current SSH connection belongs to, if any. */
export const getActiveRemote = () =>
  invoke<Profile | null>("get_active_remote");

/**
 * Exit the app. With stopStack, `run.py --stop` runs on the active remote
 * first (rejecting instead of quitting when it fails, so the caller can
 * offer "quit anyway").
 */
export const quitApp = (stopStack: boolean) =>
  invoke<void>("quit_app", { stopStack });

/** Output lines from the remote `run.py --stop` during a stopping quit. */
export const onRemoteStopLine = (
  handler: (line: string) => void,
): Promise<UnlistenFn> =>
  listen<string>("remote-stop-line", (event) => handler(event.payload));

/** Narrow an unknown invoke() rejection into an SshErrorPayload if possible. */
export function asSshError(e: unknown): SshErrorPayload | null {
  if (typeof e === "object" && e !== null && "code" in e) {
    return e as SshErrorPayload;
  }
  return null;
}

// ---- stack updates (update/stack.rs) ----

export type StackUpdatePolicy = "auto" | "prompt" | "never";

export type StackSkipReason =
  | "up_to_date"
  | "dirty_checkout"
  | "not_on_release"
  | "offline"
  | "policy_never"
  | "no_checkout";

export interface StackCheckoutRef {
  tag: string | null;
  dirty: boolean;
  label: string;
}

export type StackFreshness = {
  current: StackCheckoutRef | null;
  latest_tag: string | null;
} & (
  | { action: "update"; from: string; to: string }
  | { action: "ask"; from: string; to: string }
  | { action: "skip"; reason: StackSkipReason }
);

/** Is the target's checkout behind the latest v* release? null profile = local. */
export const checkStackFreshness = (profile: Profile | null) =>
  invoke<StackFreshness>("check_stack_freshness", { profile });

/**
 * Run the guarded `run.py --switch <tag>` on the target (local spawn or ssh
 * exec). Resolves when done; rejects on failure — including a dirty tree,
 * which --switch itself refuses. Never forces anything.
 */
export const runStackSwitch = (profile: Profile | null, tag: string) =>
  invoke<void>("run_stack_switch", { profile, tag });

export const getStackUpdatePolicy = () =>
  invoke<StackUpdatePolicy>("get_stack_update_policy");

export const setStackUpdatePolicy = (policy: StackUpdatePolicy) =>
  invoke<void>("set_stack_update_policy", { policy });

/** Raw output lines from a running `run.py --switch`. */
export const onSwitchLine = (
  handler: (line: string) => void,
): Promise<UnlistenFn> =>
  listen<string>("switch-line", (event) => handler(event.payload));

// ---- close-button behavior (teardown.rs) ----

export type CloseBehavior =
  | "ask"
  | "minimize_to_tray"
  | "keep_running"
  | "stop_stack";

export const getCloseBehavior = () =>
  invoke<CloseBehavior>("get_close_behavior");

export const setCloseBehavior = (behavior: CloseBehavior) =>
  invoke<void>("set_close_behavior", { behavior });

/** Release the quit latch after backing out of the quit prompt. */
export const cancelQuit = () => invoke<void>("cancel_quit");

export interface SessionInfo {
  machine: string | null;
  /** Seconds the current connection has been up; null when disconnected. */
  age_secs: number | null;
}

export const getSessionInfo = () => invoke<SessionInfo>("get_session_info");

// ---- local port clearing (port_clear.rs) ----

/** What holds a port, as far as the app could prove. */
export type HolderClass =
  | { kind: "ssh_forward"; alias?: string | null }
  | { kind: "stale_self" }
  | { kind: "docker" }
  | { kind: "unknown" };

export interface FreedPort {
  port: number;
  holder: PortHolder;
  class: HolderClass;
}

export interface SkippedPort {
  port: number;
  holder?: PortHolder | null;
  class: HolderClass;
}

export interface ClearReport {
  freed: FreedPort[];
  skipped: SkippedPort[];
}

/**
 * Free the stack's local ports where it is safe to, before opening the
 * tunnel. Only holders the app can positively identify (an ssh forward, a
 * leftover TT-Studio) are cleared; everything else comes back in `skipped`.
 */
export const prepareLocalPorts = () =>
  invoke<ClearReport>("prepare_local_ports");

// ---- ssh config detection (ssh_config.rs) ----

export type UnsupportedReason = { code: "proxy"; via: string };

/** A machine found in ~/.ssh/config. Ephemeral until adopted. */
export interface DetectedHost {
  alias: string;
  hostname: string;
  port: number;
  user: string;
  identity_file?: string | null;
  local_forwards: number[];
  unsupported?: UnsupportedReason | null;
  existing_profile_id?: string | null;
}

export interface SshHostDetection {
  hosts: DetectedHost[];
  truncated: boolean;
  /** No ~/.ssh/config or no ssh binary — the UI stays silent. */
  unavailable?: string | null;
}

/** Read ~/.ssh/config. Reads files and runs `ssh -G`; never touches a network. */
export const detectSshHosts = () =>
  invoke<SshHostDetection>("detect_ssh_hosts");

/** Save a detected host as a real profile so it can be connected to. */
export const adoptDetectedHost = (host: DetectedHost) =>
  invoke<Profile>("adopt_detected_host", { host });

// ---- last session / resume (session.rs) ----

export interface ResumePlan {
  profile: Profile;
  stack_left_running: boolean;
  age_secs: number;
}

/**
 * The machine to resume to, or null. Consumes this process's single resume
 * attempt: every later call returns null, however often the launcher remounts.
 */
export const takeResumeTarget = () =>
  invoke<ResumePlan | null>("take_resume_target");

export const clearLastSession = () => invoke<void>("clear_last_session");

/** Stop auto-resuming, but keep remembering which machine it was. */
export const suppressResume = () => invoke<void>("suppress_resume");

export const getResumeOnLaunch = () => invoke<boolean>("get_resume_on_launch");

export const setResumeOnLaunch = (enabled: boolean) =>
  invoke<void>("set_resume_on_launch", { enabled });

// ---- bug reports (bug_report.rs) ----

export interface BugReportResult {
  /** Local path of the collected bundle ZIP. */
  path: string;
  /** The ttbr-<hex> id to quote in an issue. */
  reference: string | null;
}

/**
 * Run `run.py --report-bug` on the target (null = local checkout; an SSH
 * profile collects remotely and copies the ZIP back), then reveal the ZIP in
 * the file manager. Progress lines stream as `bugreport-line` events.
 */
export const createBugReport = (profile: Profile | null) =>
  invoke<BugReportResult>("create_bug_report", { profile });

export const onBugReportLine = (
  handler: (line: string) => void,
): Promise<UnlistenFn> =>
  listen<string>("bugreport-line", (event) => handler(event.payload));

// ---- launcher logs (logs.rs) ----

export interface LogFileInfo {
  name: string;
  size_bytes: number;
  modified_secs: number;
  /** NDJSON event stream (level filtering applies). */
  ndjson: boolean;
}

export interface LogTail {
  content: string;
  truncated: boolean;
}

export const listAppLogs = () => invoke<LogFileInfo[]>("list_app_logs");

export const readAppLog = (name: string) =>
  invoke<LogTail>("read_app_log", { name });

/** Native save dialog; resolves to the chosen path or null on cancel. */
export const exportAppLog = (name: string) =>
  invoke<string | null>("export_app_log", { name });

// ---- navigation ----

/** Open the OS Model Terms in the system browser (fixed URL, Rust-side). */
export const openTerms = () => invoke<void>("open_terms");

export const openStack = (url: string) => invoke<void>("open_stack", { url });
