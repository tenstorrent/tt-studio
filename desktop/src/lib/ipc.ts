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

/** Raw NDJSON lines from `run.py --json-events` (parse with events.ts). */
export const onBringUpLine = (
  handler: (line: string) => void,
): Promise<UnlistenFn> =>
  listen<string>("bringup-line", (event) => handler(event.payload));

/** Exit code of the bring-up child; null when killed by a signal. */
export const onBringUpExit = (
  handler: (code: number | null) => void,
): Promise<UnlistenFn> =>
  listen<number | null>("bringup-exit", (event) => handler(event.payload));

// ---- navigation ----

export const openStack = (url: string) => invoke<void>("open_stack", { url });
