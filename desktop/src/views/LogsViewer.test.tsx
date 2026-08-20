// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LogsViewer from "./LogsViewer";

const listAppLogs = vi.fn();
const readAppLog = vi.fn();
const exportAppLog = vi.fn();

vi.mock("../lib/ipc", () => ({
  listAppLogs: (...args: unknown[]) => listAppLogs(...args),
  readAppLog: (...args: unknown[]) => readAppLog(...args),
  exportAppLog: (...args: unknown[]) => exportAppLog(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ev = (event: string, detail: object) =>
  JSON.stringify({ v: 1, ts: 1, event, phase: null, detail });

const NDJSON_FILE = {
  name: "bringup.ndjson",
  size_bytes: 100,
  modified_secs: 2,
  ndjson: true,
};
const STDERR_FILE = {
  name: "bringup.log",
  size_bytes: 50,
  modified_secs: 1,
  ndjson: false,
};

describe("LogsViewer", () => {
  it("lists log files and renders the newest one's tail", async () => {
    listAppLogs.mockResolvedValue([NDJSON_FILE, STDERR_FILE]);
    readAppLog.mockResolvedValue({
      content: [
        ev("note", { text: "starting" }),
        ev("error", { message: "no docker" }),
      ].join("\n"),
      truncated: false,
    });
    render(<LogsViewer onBack={() => {}} />);

    await waitFor(() =>
      expect(screen.getByTestId("logs-body").textContent).toContain(
        "starting",
      ),
    );
    expect(readAppLog).toHaveBeenCalledWith("bringup.ndjson");
    expect(screen.getByTestId("logs-body").textContent).toContain(
      "error: no docker",
    );
  });

  it("filters NDJSON lines by level", async () => {
    listAppLogs.mockResolvedValue([NDJSON_FILE]);
    readAppLog.mockResolvedValue({
      content: [
        ev("note", { text: "quiet" }),
        ev("error", { message: "loud" }),
      ].join("\n"),
      truncated: false,
    });
    render(<LogsViewer onBack={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("logs-body").textContent).toContain("quiet"),
    );

    fireEvent.change(screen.getByTestId("logs-level"), {
      target: { value: "error" },
    });
    const body = screen.getByTestId("logs-body").textContent ?? "";
    expect(body).toContain("error: loud");
    expect(body).not.toContain("quiet");
  });

  it("exports through the ipc save dialog", async () => {
    listAppLogs.mockResolvedValue([STDERR_FILE]);
    readAppLog.mockResolvedValue({ content: "boom\n", truncated: false });
    exportAppLog.mockResolvedValue("/tmp/bringup.log");
    render(<LogsViewer onBack={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("logs-body").textContent).toContain("boom"),
    );

    fireEvent.click(screen.getByTestId("logs-export"));
    await waitFor(() =>
      expect(screen.getByTestId("logs-notice").textContent).toContain(
        "/tmp/bringup.log",
      ),
    );
    expect(exportAppLog).toHaveBeenCalledWith("bringup.log");
  });

  it("says so when there are no logs yet", async () => {
    listAppLogs.mockResolvedValue([]);
    render(<LogsViewer onBack={() => {}} />);
    await waitFor(() =>
      expect(screen.getByTestId("logs-body").textContent).toContain(
        "No launcher logs yet",
      ),
    );
  });
});
