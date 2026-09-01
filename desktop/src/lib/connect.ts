// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Pure decisions for the one-click SSH connect flow: which tunnel forwards
// are allowed to fail, how to describe each stage, and how each
// classification / failure becomes an error card. No IPC here.

import type {
  PortHolder,
  Profile,
  StackClassification,
  TunnelStatus,
} from "./ipc";

/**
 * Ports the stack cannot work without. The web app derives service URLs
 * from window.location + these fixed numbers, so the local listeners must
 * bind the REAL ports — remapping is not an option. Marketplace app ports
 * are deliberately absent: they're forwarded dynamically while connected
 * (ssh/app_ports.rs), and a taken app port only affects that one app, not
 * the connect flow.
 */
export const ESSENTIAL_PORTS = [3000, 8000, 8001, 8002, 4000, 8080];

/** An essential port the tunnel couldn't bind, and who has it. */
export interface BlockedPort {
  port: number;
  /** Absent when the holder probe found nothing (or isn't available). */
  holder?: PortHolder | null;
}

/**
 * Essential local ports the tunnel failed to bind (already taken by another
 * program). Empty while not connected.
 */
export function blockedPorts(status: TunnelStatus | null): BlockedPort[] {
  if (status?.phase.state !== "connected") return [];
  return status.forwards
    .filter((f) => !f.active && ESSENTIAL_PORTS.includes(f.remote_port))
    .map((f) => ({ port: f.remote_port, holder: f.holder }));
}

/** "ssh (pid 95452)" — how a holder reads inside a sentence. */
function describeHolder(holder: PortHolder): string {
  return `${holder.name} (pid ${holder.pid})`;
}

/** One failure card shown in place of the connect progress. */
export interface ConnectErrorInfo {
  title: string;
  body: string;
  /** A copyable command that fixes it, when one exists. */
  command?: string;
  hint?: string;
  /** Offer "Edit machine" (the profile itself needs fixing). */
  showEdit?: boolean;
}

export function portConflictCard(blocked: BlockedPort[]): ConnectErrorInfo {
  const ports = blocked.map((b) => b.port);
  const holders = blocked.filter(
    (b): b is BlockedPort & { holder: PortHolder } => b.holder != null,
  );
  // One `kill` only when a single process explains every blocked port —
  // otherwise the command would fix half the problem and read as a fix.
  const pids = [...new Set(holders.map((b) => b.holder.pid))];
  const command =
    holders.length === blocked.length && pids.length === 1
      ? `kill ${pids[0]}`
      : undefined;

  if (ports.includes(3000)) {
    const holder = blocked.find((b) => b.port === 3000)?.holder;
    return {
      title: "Port 3000 is already in use",
      body: holder
        ? `Port 3000 on this computer is held by ${describeHolder(holder)}. ` +
          "The remote stack has to be served on its real ports, so it can't be remapped around."
        : "Another TT-Studio or dev server is using port 3000 on this computer. " +
          "The remote stack has to be served on its real ports, so it can't be remapped around.",
      command,
      hint: holder
        ? "Stop that process, then connect again. An ssh holder usually means a LocalForward in your ~/.ssh/config."
        : "Stop the other server (for a local TT-Studio: python run.py --stop), then connect again.",
    };
  }
  const list = ports.join(", ");
  const plural = ports.length > 1 ? "s" : "";
  const heldBy = holders.length
    ? ` Held by ${[...new Set(holders.map((b) => describeHolder(b.holder)))].join(", ")}.`
    : "";
  return {
    title: `Port${plural} ${list} already in use`,
    body:
      `Another program on this computer is using port${plural} ${list}, ` +
      `which the TT-Studio stack needs.${heldBy}`,
    command,
    hint: "Free the port and connect again.",
  };
}

/**
 * The error card for a classification the connect flow can't proceed from,
 * or null when it can (healthy / partial / down).
 */
export function classificationCard(
  classification: StackClassification,
  profile: Profile,
): ConnectErrorInfo | null {
  const host = profile.host ?? profile.name;
  switch (classification.kind) {
    case "no_checkout":
      return {
        title: `TT-Studio isn't set up on ${profile.name}`,
        body: `There is no run.py at ${classification.path} on ${host}. Clone the repo there, or point this machine's repo path at an existing checkout.`,
        command: `ssh ${profile.user ? `${profile.user}@` : ""}${host} git clone https://github.com/tenstorrent/tt-studio.git ${classification.path}`,
        showEdit: true,
      };
    case "python_missing":
      return {
        title: `Python 3.12+ is required on ${profile.name}`,
        body: `TT-Studio's launcher needs python3 on ${host}, but probing it failed: ${classification.message}`,
        showEdit: false,
      };
    case "python_too_old":
      return {
        title: `Python on ${profile.name} is too old`,
        body: `${host} has ${classification.found}, but TT-Studio's launcher needs Python ${classification.required} or newer.`,
        showEdit: false,
      };
    default:
      return null;
  }
}

/** The connect flow's stages, in the order they happen. */
export type ConnectStep = "tunnel" | "classify" | "bringup" | "attach";

/** One-line progress description for the current stage. */
export function describeStep(step: ConnectStep, machine: string): string {
  switch (step) {
    case "tunnel":
      return `Opening SSH tunnel to ${machine}…`;
    case "classify":
      return `Checking what's running on ${machine}…`;
    case "bringup":
      return `Starting the TT-Studio stack on ${machine}…`;
    case "attach":
      return `Stack found on ${machine} — waiting for services…`;
  }
}
