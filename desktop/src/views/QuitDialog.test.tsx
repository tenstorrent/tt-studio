// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuitDialog from "./QuitDialog";

afterEach(cleanup);

const base = {
  machine: "QuietBox",
  stopping: false,
  lines: [],
  error: null,
  onStopAndQuit: () => {},
  onDisconnectQuit: () => {},
  onCancel: () => {},
};

describe("QuitDialog", () => {
  it("offers stop, disconnect and cancel for an active remote", () => {
    const onStop = vi.fn();
    const onDisconnect = vi.fn();
    const onCancel = vi.fn();
    render(
      <QuitDialog
        {...base}
        onStopAndQuit={onStop}
        onDisconnectQuit={onDisconnect}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText("Disconnect from QuietBox?")).toBeTruthy();
    fireEvent.click(screen.getByTestId("quit-stop"));
    expect(onStop).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("quit-disconnect"));
    expect(onDisconnect).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("quit-cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("streams stop output and disables the buttons while stopping", () => {
    render(
      <QuitDialog {...base} stopping lines={["Stopping containers…"]} />,
    );
    expect(screen.getByTestId("quit-stop-output").textContent).toContain(
      "Stopping containers…",
    );
    expect(
      (screen.getByTestId("quit-stop") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("quit-disconnect") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("turns a failed stop into quit-anyway", () => {
    render(<QuitDialog {...base} error="connection lost" />);
    expect(screen.getByTestId("quit-error").textContent).toContain(
      "connection lost",
    );
    expect(screen.queryByTestId("quit-stop")).toBeNull();
    expect(screen.getByTestId("quit-disconnect").textContent).toContain(
      "Quit anyway",
    );
  });

  it("degrades to a plain quit with no active remote", () => {
    render(<QuitDialog {...base} machine={null} />);
    expect(screen.getByText("Quit TT-Studio?")).toBeTruthy();
    expect(screen.queryByTestId("quit-stop")).toBeNull();
  });
});
