// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// First-run connection picker: run TT-Studio on this machine (when a
// Tenstorrent accelerator is present) or connect to a remote machine over
// SSH. Pure view — all IPC stays in App.

import type { HardwareProbe, Profile } from "../lib/ipc";

/**
 * What the picker should pre-select on load: `"local"` when the machine has
 * an accelerator, otherwise the most recently used SSH profile's id, or null
 * when there is nothing to select yet (fresh install, no hardware).
 * Exported for unit tests.
 */
export function defaultSelection(
  hardware: HardwareProbe | null,
  profiles: Profile[],
): "local" | string | null {
  if (hardware?.accelerator_present) return "local";
  const ssh = profiles.filter((p) => p.kind === "ssh");
  if (ssh.length === 0) return null;
  const mostRecent = [...ssh].sort(
    (a, b) => (b.last_used ?? 0) - (a.last_used ?? 0),
  )[0];
  return mostRecent.id;
}

export function describeAuth(profile: Profile): string {
  if (!profile.auth || profile.auth.method === "agent") return "ssh-agent";
  return `key ${profile.auth.path}`;
}

interface Props {
  hardware: HardwareProbe | null;
  profiles: Profile[];
  onConnectLocal: () => void;
  onConnectSsh: (profile: Profile) => void;
  onAddMachine: () => void;
  onEditProfile: (profile: Profile) => void;
  onDeleteProfile: (profile: Profile) => void;
}

function ConnectionPicker({
  hardware,
  profiles,
  onConnectLocal,
  onConnectSsh,
  onAddMachine,
  onEditProfile,
  onDeleteProfile,
}: Props) {
  const selected = defaultSelection(hardware, profiles);
  const sshProfiles = profiles.filter((p) => p.kind === "ssh");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-950 px-6 text-zinc-100">
      <header className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">TT-Studio</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Where do you want to run it?
        </p>
      </header>

      <section className="flex w-full max-w-md flex-col gap-3">
        {hardware?.accelerator_present && (
          <button
            type="button"
            onClick={onConnectLocal}
            data-testid="connect-local"
            className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
              selected === "local"
                ? "border-purple-500 bg-purple-500/10"
                : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
            }`}
          >
            <span>
              <span className="block text-sm font-medium">
                Run on this machine
              </span>
              <span className="block text-xs text-zinc-400">
                Tenstorrent accelerator detected
              </span>
            </span>
            <span className="text-xs font-medium text-purple-400">
              Recommended
            </span>
          </button>
        )}

        {sshProfiles.map((profile) => (
          <div
            key={profile.id}
            data-testid={`profile-${profile.id}`}
            className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
              selected === profile.id
                ? "border-purple-500 bg-purple-500/10"
                : "border-zinc-800 bg-zinc-900"
            }`}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{profile.name}</p>
              <p className="truncate text-xs text-zinc-400">
                {profile.user ? `${profile.user}@` : ""}
                {profile.host}
                {profile.port && profile.port !== 22 ? `:${profile.port}` : ""}
                {" · "}
                {describeAuth(profile)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => onEditProfile(profile)}
                className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDeleteProfile(profile)}
                className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => onConnectSsh(profile)}
                data-testid={`connect-${profile.id}`}
                className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-500"
              >
                Connect
              </button>
            </div>
          </div>
        ))}

        {!hardware?.accelerator_present && sshProfiles.length === 0 && (
          <p
            data-testid="picker-empty"
            className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-400"
          >
            No Tenstorrent hardware found on this machine. Add a machine that
            has one to connect over SSH.
          </p>
        )}

        <button
          type="button"
          onClick={onAddMachine}
          data-testid="add-machine"
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
        >
          + Add machine
        </button>
      </section>
    </main>
  );
}

export default ConnectionPicker;
