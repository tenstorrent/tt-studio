// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StackHealth } from "../lib/ipc";
import QuitDialog from "./QuitDialog";

afterEach(cleanup);

const base = {
  machine: "QuietBox",
  stopping: false,
  lines: [],
  error: null,
  sessionAge: null,
  health: null,
  remember: false,
  onRememberChange: () => {},
  onStopAndQuit: () => {},
  onDisconnectQuit: () => {},
  onCancel: () => {},
};

const health = (up: number, down: number): StackHealth => ({
  ready: down === 0,
  services: [
    ...Array.from({ length: up }, (_, i) => ({
      name: `up-${i}`,
      url: `http://localhost:300${i}/`,
      status: "up" as const,
    })),
    ...Array.from({ length: down }, (_, i) => ({
      name: `down-${i}`,
      url: `http://localhost:800${i}/`,
      status: "down" as const,
    })),
  ],
});

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

  it("records the choice only when remember is ticked", () => {
    const onRemember = vi.fn();
    render(<QuitDialog {...base} onRememberChange={onRemember} />);
    const box = screen.getByTestId("quit-remember") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onRemember).toHaveBeenCalledWith(true);
  });

  it("says how long the session has been up and what is running", () => {
    render(<QuitDialog {...base} sessionAge="2h 14m" health={health(3, 2)} />);
    const line = screen.getByTestId("quit-session").textContent ?? "";
    expect(line).toContain("2h 14m");
    expect(line).toContain("3 of 5 services running");
  });

  it("stays fully usable before the health probe lands", () => {
    // The probe is a courtesy; it must never gate quitting.
    render(<QuitDialog {...base} health={null} sessionAge={null} />);
    expect(screen.queryByTestId("quit-session")).toBeNull();
    expect(
      (screen.getByTestId("quit-stop") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("quit-disconnect") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("degrades to a plain quit with no active remote", () => {
    render(<QuitDialog {...base} machine={null} />);
    expect(screen.getByText("Quit TT-Studio?")).toBeTruthy();
    expect(screen.queryByTestId("quit-stop")).toBeNull();
  });
});
