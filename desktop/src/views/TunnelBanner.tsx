// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Tunnel status banner + trust-on-first-use host key dialog for SSH
// connections. Pure views — all IPC stays in App.

import type { SshErrorPayload, TunnelStatus } from "../lib/ipc";

/**
 * One-line description of the tunnel state for the banner. Exported for
 * unit tests.
 */
export function describeTunnel(status: TunnelStatus | null): string {
  if (!status) return "Starting SSH tunnel…";
  switch (status.phase.state) {
    case "connecting":
      return "Opening SSH tunnel…";
    case "connected": {
      const active = status.forwards.filter((f) => f.active).length;
      return `SSH tunnel up — forwarding ${active} ports`;
    }
    case "reconnecting":
      return `SSH tunnel dropped — reconnecting (attempt ${status.phase.attempt})…`;
    case "lost":
      return `SSH tunnel lost: ${describeSshError(status.phase.error)}`;
  }
}

export function describeSshError(error: SshErrorPayload): string {
  switch (error.code) {
    case "dns":
      return "hostname could not be resolved";
    case "refused":
      return "connection refused — is sshd running?";
    case "timeout":
      return "connection timed out";
    case "auth_failed":
      return `authentication failed (${error.message ?? "all methods rejected"})`;
    case "key_file":
      return `problem with key file ${error.path ?? ""}: ${error.message ?? ""}`;
    case "unknown_host_key":
      return "the machine's host key is not trusted yet";
    case "changed_host_key":
      return `HOST KEY CHANGED for ${error.host} — refusing to connect. If the machine was reinstalled, remove it from the app's known_hosts file and reconnect.`;
    default:
      return error.message ?? error.code;
  }
}

const PHASE_STYLE: Record<string, string> = {
  connecting: "border-zinc-700 text-zinc-300",
  connected: "border-emerald-700 text-emerald-300",
  reconnecting: "border-amber-700 text-amber-300",
  lost: "border-red-800 text-red-300",
};

export function TunnelBanner({ status }: { status: TunnelStatus | null }) {
  const phase = status?.phase.state ?? "connecting";
  return (
    <div
      role="status"
      className={`w-full max-w-sm rounded-md border bg-zinc-900 px-3 py-2 text-center text-xs ${
        PHASE_STYLE[phase] ?? PHASE_STYLE.connecting
      }`}
    >
      {describeTunnel(status)}
    </div>
  );
}

interface TrustPromptProps {
  error: SshErrorPayload; // code === "unknown_host_key"
  onTrust: () => void;
  onReject: () => void;
}

/**
 * First contact with a machine: show the key fingerprint and let the user
 * decide. Accepting persists the key; every later connection must match it.
 */
export function TrustHostKeyDialog({ error, onTrust, onReject }: TrustPromptProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 px-6 text-zinc-100">
      <header className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Trust this machine?
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {error.host}
          {error.port && error.port !== 22 ? `:${error.port}` : ""} has never
          been seen before. Verify the fingerprint matches the machine you
          expect (run <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>{" "}
          on it) before trusting.
        </p>
      </header>
      <dl className="w-full max-w-md rounded-md border border-zinc-800 bg-zinc-900 p-4 text-sm">
        <dt className="text-xs uppercase tracking-wide text-zinc-500">
          Key type
        </dt>
        <dd className="mb-3">{error.key_type}</dd>
        <dt className="text-xs uppercase tracking-wide text-zinc-500">
          SHA256 fingerprint
        </dt>
        <dd className="break-all font-mono text-xs">{error.fingerprint}</dd>
      </dl>
      <div className="flex gap-3">
        <button
          onClick={onReject}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          Cancel
        </button>
        <button
          onClick={onTrust}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Trust and connect
        </button>
      </div>
    </main>
  );
}
