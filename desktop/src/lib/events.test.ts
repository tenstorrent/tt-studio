// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from "vitest";
import {
  applyExit,
  initialBringUpState,
  parseEventLine,
  reduceEvent,
  reduceStream,
} from "./events";

// Fixture streams mirroring dev-docs/json-events.md.

export const SUCCESS_STREAM = [
  `{"v": 1, "ts": 1.0, "event": "phase_begin", "phase": "Checks", "detail": {"index": 1, "total": 5}}`,
  `{"v": 1, "ts": 1.1, "event": "progress", "phase": "Checks", "detail": {"activity": "tt-smi"}}`,
  `{"v": 1, "ts": 3.5, "event": "phase_end", "phase": "Checks", "detail": {"index": 1, "status": "ok", "duration_s": 2.5}}`,
  `{"v": 1, "ts": 4.0, "event": "phase_begin", "phase": "Pull", "detail": {"index": 2, "total": 5}}`,
  `{"v": 1, "ts": 4.5, "event": "progress", "phase": "Build", "detail": {"kind": "phase_renamed"}}`,
  `{"v": 1, "ts": 5.0, "event": "progress", "phase": "Build", "detail": {"kind": "pulled", "service": "frontend"}}`,
  `{"v": 1, "ts": 6.0, "event": "note", "phase": "Build", "detail": {"text": "image pull skipped (cached)"}}`,
  `{"v": 1, "ts": 7.0, "event": "phase_end", "phase": "Build", "detail": {"index": 2, "status": "ok", "duration_s": 3.0}}`,
  `{"v": 1, "ts": 8.0, "event": "warn", "phase": null, "detail": {"text": "HF_TOKEN not set — gated models unavailable"}}`,
  `{"v": 1, "ts": 9.0, "event": "ready", "phase": null, "detail": {"urls": {"app": "http://localhost:3000", "fastapi": "http://localhost:8001"}, "hardware": "QuietBox (QB2) · 4 device(s)"}}`,
].join("\n");

export const FAILURE_STREAM = [
  `{"v": 1, "ts": 1.0, "event": "phase_begin", "phase": "Launch", "detail": {"index": 5, "total": 5}}`,
  `{"v": 1, "ts": 2.0, "event": "error", "phase": "Launch", "detail": {"message": "Inference server didn't start — port 8001 is still taken", "remediation": "lsof -i :8001; python run.py --stop, then re-run", "service": "Inference server", "log": "fastapi.log"}}`,
  `{"v": 1, "ts": 2.1, "event": "phase_end", "phase": "Launch", "detail": {"index": 5, "status": "failed"}}`,
].join("\n");

export const PROMPT_BLOCKED_STREAM = [
  `{"v": 1, "ts": 1.0, "event": "phase_begin", "phase": "Configure", "detail": {"index": 2, "total": 5}}`,
  `{"v": 1, "ts": 2.0, "event": "prompt_blocked", "phase": "Configure", "detail": {"prompt": "Enter your Hugging Face token", "remediation": "set HF_TOKEN in .env, then re-run"}}`,
].join("\n");

describe("parseEventLine", () => {
  it("parses a valid v1 envelope", () => {
    const event = parseEventLine(
      `{"v": 1, "ts": 2.5, "event": "note", "phase": "Checks", "detail": {"text": "hi"}}`,
    );
    expect(event).toEqual({
      v: 1,
      ts: 2.5,
      event: "note",
      phase: "Checks",
      detail: { text: "hi" },
    });
  });

  it("returns null for non-JSON bootstrap lines and blanks", () => {
    expect(parseEventLine("Creating venv…")).toBeNull();
    expect(parseEventLine("")).toBeNull();
    expect(parseEventLine("   ")).toBeNull();
  });

  it("returns null for JSON that is not a v1 event envelope", () => {
    expect(parseEventLine(`[1, 2, 3]`)).toBeNull();
    expect(parseEventLine(`"just a string"`)).toBeNull();
    expect(parseEventLine(`{"v": 2, "event": "note"}`)).toBeNull();
    expect(parseEventLine(`{"v": 1, "ts": 1.0}`)).toBeNull();
  });

  it("tolerates a missing or malformed detail", () => {
    const event = parseEventLine(`{"v": 1, "ts": 1.0, "event": "note"}`);
    expect(event?.detail).toEqual({});
    expect(event?.phase).toBeNull();
  });
});

describe("reduceEvent / reduceStream", () => {
  it("folds a successful bring-up into ok phases and ready state", () => {
    const state = reduceStream(SUCCESS_STREAM);
    expect(state.totalPhases).toBe(5);
    expect(state.phases.map((p) => [p.name, p.status])).toEqual([
      ["Checks", "ok"],
      ["Build", "ok"], // renamed from Pull mid-phase
    ]);
    expect(state.phases[0].durationS).toBe(2.5);
    expect(state.notes).toEqual(["image pull skipped (cached)"]);
    expect(state.warnings).toEqual([
      "HF_TOKEN not set — gated models unavailable",
    ]);
    expect(state.errors).toEqual([]);
    expect(state.ready?.urls.app).toBe("http://localhost:3000");
    expect(state.ready?.hardware).toContain("QuietBox");
  });

  it("tracks the running phase's activity from progress events", () => {
    const state = reduceStream(
      SUCCESS_STREAM.split("\n").slice(0, 2).join("\n"),
    );
    expect(state.phases[0].status).toBe("running");
    expect(state.phases[0].activity).toBe("tt-smi");
  });

  it("folds a failure into an error card and a failed phase", () => {
    const state = reduceStream(FAILURE_STREAM);
    expect(state.phases).toEqual([
      expect.objectContaining({ name: "Launch", status: "failed" }),
    ]);
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0].message).toContain("port 8001");
    expect(state.errors[0].remediation).toContain("--stop");
    expect(state.errors[0].service).toBe("Inference server");
    expect(state.errors[0].log).toBe("fastapi.log");
    expect(state.ready).toBeNull();
  });

  it("captures prompt_blocked with its remediation", () => {
    const state = reduceStream(PROMPT_BLOCKED_STREAM);
    expect(state.promptBlocked?.prompt).toContain("Hugging Face");
    expect(state.promptBlocked?.remediation).toContain("HF_TOKEN");
  });

  it("ignores unknown event types (non-breaking within v1)", () => {
    const before = initialBringUpState();
    const after = reduceEvent(before, {
      v: 1,
      ts: 1,
      event: "totally_new_thing",
      phase: null,
      detail: { anything: true },
    });
    expect(after).toEqual(before);
  });

  it("skips unparseable lines mixed into the stream", () => {
    const state = reduceStream(
      `pre-bootstrap chatter\n${FAILURE_STREAM}\nmore chatter`,
    );
    expect(state.errors).toHaveLength(1);
  });
});

describe("applyExit (child died — was the stream self-explanatory?)", () => {
  it("leaves a ready or already-explained stream alone", () => {
    const ready = reduceStream(SUCCESS_STREAM);
    expect(applyExit(ready, 0)).toBe(ready);
    const failed = reduceStream(FAILURE_STREAM);
    expect(applyExit(failed, 1)).toBe(failed);
    const blocked = reduceStream(PROMPT_BLOCKED_STREAM);
    expect(applyExit(blocked, 2)).toBe(blocked);
  });

  it("turns a bare exit 2 into a prompt-blocked card", () => {
    const state = applyExit(initialBringUpState(), 2);
    expect(state.promptBlocked?.remediation).toBe("python run.py");
  });

  it("turns an unexplained crash or kill into an error card", () => {
    const crashed = applyExit(initialBringUpState(), 1);
    expect(crashed.errors[0].message).toContain("exited with code 1");
    expect(crashed.errors[0].remediation).toBe("python run.py");

    const killed = applyExit(initialBringUpState(), null);
    expect(killed.errors[0].message).toContain("interrupted");
  });
});
