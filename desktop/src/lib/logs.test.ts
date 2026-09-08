// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from "vitest";
import {
  classifyLog,
  classifyNdjsonLine,
  filterByLevel,
  formatSize,
} from "./logs";

const ev = (event: string, detail: object, phase: string | null = null) =>
  JSON.stringify({ v: 1, ts: 1, event, phase, detail });

describe("classifyNdjsonLine", () => {
  it("maps event types to levels", () => {
    expect(classifyNdjsonLine(ev("error", { message: "boom" }))).toMatchObject({
      level: "error",
      text: "error: boom",
    });
    expect(
      classifyNdjsonLine(ev("prompt_blocked", { prompt: "sudo" })).level,
    ).toBe("error");
    expect(classifyNdjsonLine(ev("warn", { text: "careful" }))).toMatchObject({
      level: "warn",
      text: "warn: careful",
    });
    expect(classifyNdjsonLine(ev("note", { text: "fyi" }))).toMatchObject({
      level: "info",
      text: "fyi",
    });
  });

  it("renders phase transitions compactly", () => {
    expect(classifyNdjsonLine(ev("phase_begin", {}, "Pull")).text).toBe(
      "▶ Pull",
    );
    expect(
      classifyNdjsonLine(ev("phase_end", { status: "ok" }, "Pull")),
    ).toMatchObject({ level: "info", text: "✓ Pull" });
    expect(
      classifyNdjsonLine(ev("phase_end", { status: "failed" }, "Pull")),
    ).toMatchObject({ level: "error", text: "✗ Pull" });
  });

  it("passes unparseable lines through as info", () => {
    expect(classifyNdjsonLine("bootstrap: creating venv")).toMatchObject({
      level: "info",
      text: "bootstrap: creating venv",
    });
  });
});

describe("classifyLog / filterByLevel", () => {
  it("splits, classifies and filters a document", () => {
    const doc = [
      ev("note", { text: "starting" }),
      ev("warn", { text: "slow disk" }),
      ev("error", { message: "no docker" }),
      "",
    ].join("\n");
    const lines = classifyLog(doc, true);
    expect(lines).toHaveLength(3);
    expect(filterByLevel(lines, "info")).toHaveLength(3);
    expect(filterByLevel(lines, "warn").map((l) => l.level)).toEqual([
      "warn",
      "error",
    ]);
    expect(filterByLevel(lines, "error")).toHaveLength(1);
  });

  it("treats plain stderr logs as all-info", () => {
    const lines = classifyLog("Traceback (most recent call last):\n  boom\n", false);
    expect(lines.map((l) => l.level)).toEqual(["info", "info"]);
    expect(filterByLevel(lines, "error")).toHaveLength(0);
  });
});

describe("formatSize", () => {
  it("humanizes byte counts", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
