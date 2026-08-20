// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeSshError,
  describeTunnel,
  TrustHostKeyDialog,
  TunnelBanner,
} from "./TunnelBanner";
import type { SshErrorPayload, TunnelStatus } from "../lib/ipc";

afterEach(cleanup);

const connected: TunnelStatus = {
  phase: { state: "connected" },
  forwards: [
    { local_port: 3000, remote_port: 3000, active: true },
    { local_port: 8000, remote_port: 8000, active: true },
    { local_port: 4000, remote_port: 4000, active: false },
  ],
};

const unknownKey: SshErrorPayload = {
  code: "unknown_host_key",
  host: "qb2.lan",
  port: 22,
  key_type: "ssh-ed25519",
  fingerprint: "SHA256:abcdef",
  public_key: "ssh-ed25519 AAAA",
};

describe("describeTunnel", () => {
  it("counts only active forwards when connected", () => {
    expect(describeTunnel(connected)).toBe("SSH tunnel up — forwarding 2 ports");
  });

  it("shows the reconnect attempt", () => {
    expect(
      describeTunnel({
        phase: { state: "reconnecting", attempt: 3, next_delay_secs: 4 },
        forwards: [],
      }),
    ).toContain("attempt 3");
  });

  it("explains a lost tunnel with the typed error", () => {
    expect(
      describeTunnel({
        phase: { state: "lost", error: { code: "refused" } },
        forwards: [],
      }),
    ).toContain("connection refused");
  });

  it("treats a changed host key as a hard, explained failure", () => {
    const text = describeSshError({
      code: "changed_host_key",
      host: "qb2.lan",
      port: 22,
      fingerprint: "SHA256:x",
    });
    expect(text).toContain("HOST KEY CHANGED");
    expect(text).toContain("qb2.lan");
  });
});

describe("TunnelBanner", () => {
  it("renders the current phase as a status line", () => {
    render(<TunnelBanner status={connected} />);
    expect(screen.getByRole("status").textContent).toContain("SSH tunnel up");
  });
});

describe("TrustHostKeyDialog", () => {
  it("shows the fingerprint and wires both choices", () => {
    const onTrust = vi.fn();
    const onReject = vi.fn();
    render(
      <TrustHostKeyDialog
        error={unknownKey}
        onTrust={onTrust}
        onReject={onReject}
      />,
    );
    expect(screen.getByText("SHA256:abcdef")).toBeTruthy();
    expect(screen.getByText("ssh-ed25519")).toBeTruthy();
    fireEvent.click(screen.getByText("Trust and connect"));
    expect(onTrust).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onReject).toHaveBeenCalledOnce();
  });
});
