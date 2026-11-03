// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Add/edit form for an SSH connection profile. Pure view: the caller
// persists the profile and stores the optional key passphrase in the OS
// keychain (never in the profile itself).

import { useState } from "react";
import type { Profile, SshAuth } from "../lib/ipc";

interface Props {
  /** When set, edit this profile; otherwise create a new one. */
  initial?: Profile;
  /** Shown when the OS keychain is unavailable (e.g. headless Linux). */
  keychainWarning?: string | null;
  onSave: (profile: Profile, passphrase: string | null) => void;
  onCancel: () => void;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `profile-${Math.random().toString(36).slice(2)}`;
}

function ProfileEditor({ initial, keychainWarning, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ?? 22);
  const [user, setUser] = useState(initial?.user ?? "");
  const [authMethod, setAuthMethod] = useState<"agent" | "key">(
    initial?.auth?.method ?? "agent",
  );
  const [keyPath, setKeyPath] = useState(
    initial?.auth?.method === "key" ? initial.auth.path : "",
  );
  const [passphrase, setPassphrase] = useState("");
  const [repoPath, setRepoPath] = useState(initial?.remote_repo_path ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) return setError("Give this machine a name.");
    if (!host.trim()) return setError("Hostname is required.");
    if (authMethod === "key" && !keyPath.trim())
      return setError("Choose the SSH private key to use.");
    const auth: SshAuth =
      authMethod === "agent"
        ? { method: "agent" }
        : { method: "key", path: keyPath.trim() };
    onSave(
      {
        id: initial?.id ?? newId(),
        name: name.trim(),
        kind: "ssh",
        host: host.trim(),
        port,
        user: user.trim() || undefined,
        auth,
        remote_repo_path: repoPath.trim() || undefined,
        last_used: initial?.last_used,
      },
      authMethod === "key" && passphrase ? passphrase : null,
    );
  };

  const field =
    "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-purple-500 focus:outline-none";
  const label = "block text-xs font-medium text-zinc-400";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <form
        className="flex w-full max-w-md flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <header>
          <h1 className="text-xl font-semibold tracking-tight">
            {initial ? "Edit machine" : "Add machine"}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            A remote machine with Tenstorrent hardware, reached over SSH.
          </p>
        </header>

        <div>
          <label className={label} htmlFor="pe-name">
            Name
          </label>
          <input
            id="pe-name"
            className={field}
            placeholder="Lab QuietBox"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className={label} htmlFor="pe-host">
              Host
            </label>
            <input
              id="pe-host"
              className={field}
              placeholder="qb2.lan"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </div>
          <div className="w-24">
            <label className={label} htmlFor="pe-port">
              Port
            </label>
            <input
              id="pe-port"
              className={field}
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 22)}
            />
          </div>
        </div>

        <div>
          <label className={label} htmlFor="pe-user">
            User
          </label>
          <input
            id="pe-user"
            className={field}
            placeholder="tenstorrent"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={label}>Authentication</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="auth"
              checked={authMethod === "agent"}
              onChange={() => setAuthMethod("agent")}
            />
            ssh-agent (recommended)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="auth"
              checked={authMethod === "key"}
              onChange={() => setAuthMethod("key")}
            />
            Private key file
          </label>
          {authMethod === "key" && (
            <div className="ml-6 flex flex-col gap-2">
              <input
                aria-label="Private key path"
                className={field}
                placeholder="~/.ssh/id_ed25519"
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
              />
              <input
                aria-label="Key passphrase"
                className={field}
                type="password"
                placeholder="Key passphrase (stored in the OS keychain)"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
              {keychainWarning && (
                <p className="text-xs text-amber-400">{keychainWarning}</p>
              )}
            </div>
          )}
        </fieldset>

        <div>
          <label className={label} htmlFor="pe-repo">
            TT-Studio path on the remote (optional)
          </label>
          <input
            id="pe-repo"
            className={field}
            placeholder="~/tt-studio"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="save-profile"
            className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
          >
            Save
          </button>
        </div>
      </form>
    </main>
  );
}

export default ProfileEditor;
