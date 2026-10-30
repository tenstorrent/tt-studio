// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionPicker, {
  defaultSelection,
  noLocalReason,
  visibleDetected,
} from "./ConnectionPicker";
import type { DetectedHost, HardwareProbe, Profile } from "../lib/ipc";

const withHardware: HardwareProbe = {
  platform: "linux",
  accelerator_present: true,
  default_mode: "local",
};
const noHardware: HardwareProbe = {
  platform: "linux",
  accelerator_present: false,
  default_mode: "ssh",
};
const onMac: HardwareProbe = {
  platform: "macos",
  accelerator_present: false,
  default_mode: "ssh",
};

const qb2: Profile = {
  id: "qb2",
  name: "Lab QuietBox",
  kind: "ssh",
  host: "qb2.lan",
  port: 22,
  user: "tt",
  auth: { method: "agent" },
  last_used: 200,
};
const older: Profile = {
  id: "older",
  name: "Old box",
  kind: "ssh",
  host: "old.lan",
  auth: { method: "key", path: "~/.ssh/id_ed25519" },
  last_used: 100,
};

const noop = {
  stackUp: false,
  detected: [],
  onConnectLocal: () => {},
  onRestartStack: () => {},
  onConnectSsh: () => {},
  onConnectDetected: () => {},
  onAddMachine: () => {},
  onEditProfile: () => {},
  onDeleteProfile: () => {},
};

const host = (
  alias: string,
  extra: Partial<DetectedHost> = {},
): DetectedHost => ({
  alias,
  hostname: `${alias}.example`,
  port: 22,
  user: "jashan",
  local_forwards: [],
  ...extra,
});

afterEach(cleanup);

describe("defaultSelection (picker gating)", () => {
  it("pre-selects local when an accelerator is present", () => {
    expect(defaultSelection(withHardware, [qb2])).toBe("local");
    expect(defaultSelection(withHardware, [])).toBe("local");
  });

  it("falls back to the most recently used ssh profile without hardware", () => {
    expect(defaultSelection(noHardware, [older, qb2])).toBe("qb2");
  });

  it("selects nothing on a fresh install with no hardware", () => {
    expect(defaultSelection(noHardware, [])).toBeNull();
    expect(defaultSelection(null, [])).toBeNull();
  });
});

describe("ConnectionPicker", () => {
  it("offers 'run on this machine' only when hardware is detected", () => {
    const { unmount } = render(
      <ConnectionPicker hardware={withHardware} profiles={[]} {...noop} />,
    );
    expect(screen.getByTestId("connect-local")).toBeTruthy();
    unmount();

    render(<ConnectionPicker hardware={noHardware} profiles={[]} {...noop} />);
    expect(screen.queryByTestId("connect-local")).toBeNull();
    expect(screen.getByTestId("picker-empty")).toBeTruthy();
  });

  it("offers restart only when a local stack is already up", () => {
    const onRestartStack = vi.fn();
    const { unmount } = render(
      <ConnectionPicker
        hardware={withHardware}
        profiles={[]}
        {...noop}
        stackUp
        onRestartStack={onRestartStack}
      />,
    );
    fireEvent.click(screen.getByTestId("restart-stack"));
    expect(onRestartStack).toHaveBeenCalled();
    expect(screen.getByText(/already running/)).toBeTruthy();
    unmount();

    // Stack down → no restart affordance.
    const second = render(
      <ConnectionPicker hardware={withHardware} profiles={[]} {...noop} />,
    );
    expect(screen.queryByTestId("restart-stack")).toBeNull();
    second.unmount();

    // No hardware → no restart even if something answers on the ports.
    render(
      <ConnectionPicker
        hardware={noHardware}
        profiles={[]}
        {...noop}
        stackUp
      />,
    );
    expect(screen.queryByTestId("restart-stack")).toBeNull();
  });

  it("connects a saved ssh machine with one click", () => {
    const onConnectSsh = vi.fn();
    render(
      <ConnectionPicker
        hardware={noHardware}
        profiles={[qb2]}
        {...noop}
        onConnectSsh={onConnectSsh}
      />,
    );
    fireEvent.click(screen.getByTestId("connect-qb2"));
    expect(onConnectSsh).toHaveBeenCalledWith(qb2);
  });

  it("shows host, user, and auth detail for ssh profiles", () => {
    render(
      <ConnectionPicker hardware={noHardware} profiles={[older]} {...noop} />,
    );
    expect(screen.getByText("Old box")).toBeTruthy();
    expect(screen.getByText(/old\.lan/)).toBeTruthy();
    expect(screen.getByText(/key ~\/\.ssh\/id_ed25519/)).toBeTruthy();
  });

  it("explains why local mode is unavailable, per platform", () => {
    // Linux without the device node: point at the driver setup.
    expect(noLocalReason(noHardware)).toContain("/dev/tenstorrent");
    expect(noLocalReason(noHardware)).toContain("python run.py");
    // Non-Linux: native mode is out entirely, steer to SSH.
    expect(noLocalReason(onMac)).toContain("macOS");
    expect(noLocalReason(onMac)).toContain("SSH");
    // Hardware present (or still probing): no card.
    expect(noLocalReason(withHardware)).toBeNull();
    expect(noLocalReason(null)).toBeNull();

    const first = render(
      <ConnectionPicker hardware={onMac} profiles={[qb2]} {...noop} />,
    );
    expect(screen.getByTestId("no-local-card").textContent).toContain(
      "macOS",
    );
    // Saved SSH profiles are still front and center.
    expect(screen.getByTestId("connect-qb2")).toBeTruthy();
    first.unmount();

    render(
      <ConnectionPicker hardware={withHardware} profiles={[]} {...noop} />,
    );
    expect(screen.queryByTestId("no-local-card")).toBeNull();
  });

  it("always offers adding a machine", () => {
    const onAddMachine = vi.fn();
    render(
      <ConnectionPicker
        hardware={withHardware}
        profiles={[]}
        {...noop}
        onAddMachine={onAddMachine}
      />,
    );
    fireEvent.click(screen.getByTestId("add-machine"));
    expect(onAddMachine).toHaveBeenCalled();
  });
});

describe("visibleDetected", () => {
  it("hides hosts that are already saved profiles", () => {
    const saved = host("qb2", { existing_profile_id: "qb2" });
    expect(visibleDetected([saved, host("other")], [qb2]).map((h) => h.alias)).toEqual([
      "other",
    ]);
    // A stale id that matches nothing saved is still offered.
    expect(visibleDetected([saved], []).map((h) => h.alias)).toEqual(["qb2"]);
  });

  it("puts connectable machines before ones needing explanation", () => {
    const jump = host("aaa-jump", {
      unsupported: { code: "proxy", via: "bastion" },
    });
    expect(
      visibleDetected([jump, host("zzz")], []).map((h) => h.alias),
    ).toEqual(["zzz", "aaa-jump"]);
  });
});

describe("detected hosts section", () => {
  it("offers a one-click connect for each detected machine", () => {
    const onConnectDetected = vi.fn();
    const detected = [host("qbge-devex-01", { port: 2222 })];
    render(
      <ConnectionPicker
        hardware={noHardware}
        profiles={[]}
        {...noop}
        detected={detected}
        onConnectDetected={onConnectDetected}
      />,
    );
    expect(screen.getByTestId("detected-section").textContent).toContain(
      "~/.ssh/config",
    );
    expect(screen.getByTestId("detected-qbge-devex-01").textContent).toContain(
      "jashan@qbge-devex-01.example:2222",
    );
    fireEvent.click(screen.getByTestId("connect-detected-qbge-devex-01"));
    expect(onConnectDetected).toHaveBeenCalledWith(detected[0]);
  });

  it("explains a jump host instead of offering a dead Connect button", () => {
    render(
      <ConnectionPicker
        hardware={noHardware}
        profiles={[]}
        {...noop}
        detected={[
          host("behind", { unsupported: { code: "proxy", via: "bastion" } }),
        ]}
      />,
    );
    expect(screen.queryByTestId("connect-detected-behind")).toBeNull();
    expect(screen.getByTestId("detected-behind").textContent).toContain(
      "bastion",
    );
  });

  it("does not claim there are no machines while listing some", () => {
    render(
      <ConnectionPicker
        hardware={noHardware}
        profiles={[]}
        {...noop}
        detected={[host("qb2")]}
      />,
    );
    expect(screen.queryByTestId("picker-empty")).toBeNull();
  });

  it("keeps the empty state when nothing was detected either", () => {
    render(
      <ConnectionPicker hardware={noHardware} profiles={[]} {...noop} />,
    );
    expect(screen.getByTestId("picker-empty")).toBeTruthy();
  });
});
