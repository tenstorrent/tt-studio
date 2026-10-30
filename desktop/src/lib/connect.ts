// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Pure decisions for the one-click SSH connect flow: which tunnel forwards
// are allowed to fail, how to describe each stage, and how each
// classification / failure becomes an error card. No IPC here.

import type {
  ClearReport,
  HolderClass,
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
  // otherwise the command would fix half the problem and read as a fix. And
  // never for Docker: the listener is a proxy, not the container, so killing
  // it is both wrong and usually futile (see port_clear.rs).
  const pids = [...new Set(holders.map((b) => b.holder.pid))];
  const command =
    holders.length === blocked.length &&
    pids.length === 1 &&
    !holders.some((b) => looksLikeDocker(b.holder.name))
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
 * Docker's port listeners by name. The container publishing the port is the
 * real owner, and `run.py --stop` is what releases it.
 */
function looksLikeDocker(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "docker-proxy" ||
    lower === "docker" ||
    lower.startsWith("com.docker") ||
    lower.startsWith("vpnkit") ||
    lower.startsWith("containerd")
  );
}

/** "ssh (pid 1250)", plus the machine it is connected to when we know it. */
function describeSkipped(name: string, pid: number, klass: HolderClass): string {
  const base = `${name} (pid ${pid})`;
  return klass.kind === "ssh_forward" && klass.alias
    ? `${base}, an SSH session to ${klass.alias}`
    : base;
}

/**
 * The card for ports the pre-flight could not free. Unlike
 * `portConflictCard` this knows *what* the holder is, so it can give the
 * right remedy instead of a generic `kill`.
 */
export function portClearCard(report: ClearReport): ConnectErrorInfo {
  const stuck = report.skipped;
  const ports = stuck.map((s) => s.port);
  const list = ports.join(", ");
  const plural = ports.length > 1 ? "s" : "";
  const docker = stuck.filter((s) => s.class.kind === "docker");

  if (docker.length === stuck.length && docker.length > 0) {
    return {
      title: `Port${plural} ${list} ${plural ? "are" : "is"} published by Docker`,
      body:
        `A Docker container on this computer publishes port${plural} ${list}. ` +
        "That's almost always a TT-Studio stack already running here — stopping " +
        "the container is what frees the port; killing Docker's proxy process is not.",
      command: "python run.py --stop",
      hint: `Check with: docker ps --filter publish=${ports[0]}`,
    };
  }

  const named = stuck
    .filter((s) => s.holder)
    .map((s) => describeSkipped(s.holder!.name, s.holder!.pid, s.class));
  const heldBy = named.length ? ` Held by ${[...new Set(named)].join(", ")}.` : "";
  const pids = [...new Set(stuck.map((s) => s.holder?.pid).filter((p): p is number => p != null))];
  const killable =
    pids.length === 1 &&
    named.length === stuck.length &&
    !stuck.some((s) => s.class.kind === "docker");

  return {
    title: `Port${plural} ${list} ${plural ? "are" : "is"} already in use`,
    body:
      `The TT-Studio stack needs port${plural} ${list} on this computer, and ` +
      `something we don't recognize is holding ${plural ? "them" : "it"}.${heldBy} ` +
      "Ports held by an editor's SSH session or a leftover TT-Studio window are " +
      "freed automatically; anything else is left alone in case you're using it.",
    command: killable ? `kill ${pids[0]}` : undefined,
    hint: "Free the port and connect again.",
  };
}

/**
 * What the app killed on the user's behalf, in plain words. Null when it
 * freed nothing. Always names the port, the process and what was lost — a
 * silent kill dressed up as "cleaned up" is not acceptable.
 */
export function freedNotice(
  report: ClearReport,
  dialing?: string,
): string | null {
  if (report.freed.length === 0) return null;
  const ports = report.freed.map((f) => f.port);
  const list = ports.join(", ");
  const plural = ports.length > 1 ? "s" : "";
  const holders = [...new Set(report.freed.map((f) => f.holder.pid))];

  const ssh = report.freed.find((f) => f.class.kind === "ssh_forward");
  if (ssh && ssh.class.kind === "ssh_forward") {
    const alias = ssh.class.alias;
    const to = alias ? ` to ${alias}` : "";
    const same =
      alias && dialing && alias === dialing
        ? " That session was to this same machine, so the tunnel now covers those ports."
        : "";
    return (
      `Freed port${plural} ${list} — held by an SSH session${to} ` +
      `(pid ${ssh.holder.pid}), which has been closed. If that was your editor's ` +
      `Remote-SSH connection, it will reconnect on its own.${same}`
    );
  }
  if (report.freed.some((f) => f.class.kind === "stale_self")) {
    return (
      `Freed port${plural} ${list} — a leftover TT-Studio window ` +
      `(pid ${holders[0]}) was still holding ${plural ? "them" : "it"}.`
    );
  }
  return `Freed port${plural} ${list} (pid ${holders.join(", ")}).`;
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
export type ConnectStep =
  | "ports"
  | "tunnel"
  | "classify"
  | "bringup"
  | "attach";

/** One-line progress description for the current stage. */
export function describeStep(step: ConnectStep, machine: string): string {
  switch (step) {
    case "ports":
      return "Checking local ports on this computer…";
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
