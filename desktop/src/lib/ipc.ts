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

export interface HardwareProbe {
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

/** Narrow an unknown invoke() rejection into an SshErrorPayload if possible. */
export function asSshError(e: unknown): SshErrorPayload | null {
  if (typeof e === "object" && e !== null && "code" in e) {
    return e as SshErrorPayload;
  }
  return null;
}

// ---- navigation ----

export const openStack = (url: string) => invoke<void>("open_stack", { url });
