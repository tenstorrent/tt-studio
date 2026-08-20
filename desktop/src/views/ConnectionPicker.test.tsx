// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectionPicker, { defaultSelection } from "./ConnectionPicker";
import type { HardwareProbe, Profile } from "../lib/ipc";

const withHardware: HardwareProbe = {
  accelerator_present: true,
  default_mode: "local",
};
const noHardware: HardwareProbe = {
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
  onConnectLocal: () => {},
  onRestartStack: () => {},
  onConnectSsh: () => {},
  onAddMachine: () => {},
  onEditProfile: () => {},
  onDeleteProfile: () => {},
};

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
