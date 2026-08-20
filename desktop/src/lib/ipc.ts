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

export interface ForwardHealth {
  local_port: number;
  remote_port: number;
  active: boolean;
  last_error?: string;
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

export const startRemoteBringUp = (profile: Profile) =>
  invoke<void>("start_remote_bring_up", { profile });

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

export const startBringUp = (checkout: string) =>
  invoke<number>("start_bring_up", { checkout });

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

// ---- navigation ----

export const openStack = (url: string) => invoke<void>("open_stack", { url });
