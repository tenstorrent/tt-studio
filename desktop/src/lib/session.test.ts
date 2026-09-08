// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from "vitest";
import {
  describeSession,
  describeSessionAge,
  portClearNotice,
  resumeBlockedNotice,
  resumeNotReadyNotice,
} from "./session";

describe("describeSessionAge", () => {
  it("rounds down to the largest useful unit", () => {
    expect(describeSessionAge(0)).toBe("just now");
    expect(describeSessionAge(59)).toBe("just now");
    expect(describeSessionAge(60)).toBe("1m");
    expect(describeSessionAge(14 * 60)).toBe("14m");
    expect(describeSessionAge(3600)).toBe("1h");
    expect(describeSessionAge(2 * 3600 + 14 * 60)).toBe("2h 14m");
    expect(describeSessionAge(24 * 3600)).toBe("1 day");
    expect(describeSessionAge(3 * 24 * 3600)).toBe("3 days");
  });

  it("says nothing rather than something wrong", () => {
    expect(describeSessionAge(null)).toBeNull();
    expect(describeSessionAge(undefined)).toBeNull();
    expect(describeSessionAge(NaN)).toBeNull();
    expect(describeSessionAge(Infinity)).toBeNull();
    // A clock that went backwards.
    expect(describeSessionAge(-5)).toBeNull();
  });
});

describe("describeSession", () => {
  it("names the machine and how long it has been up", () => {
    expect(describeSession("QuietBox", "2h 14m")).toBe(
      "Connected to QuietBox for 2h 14m.",
    );
    expect(describeSession("QuietBox", "just now")).toBe(
      "Connected to QuietBox a moment ago.",
    );
    expect(describeSession("QuietBox", null)).toBe("Connected to QuietBox.");
  });

  it("has nothing to say without a machine", () => {
    expect(describeSession(null, "2h")).toBeNull();
  });
});

describe("resumeNotReadyNotice", () => {
  it("says what happened and how to act on it", () => {
    expect(resumeNotReadyNotice("QuietBox", { kind: "down" })).toBe(
      "The stack on QuietBox isn't running any more. Pick QuietBox to start it.",
    );
    expect(
      resumeNotReadyNotice("QuietBox", {
        kind: "partial",
        healthy: ["frontend"],
        unhealthy: ["backend", "agent"],
      }),
    ).toContain("backend, agent");
    expect(
      resumeNotReadyNotice("QuietBox", {
        kind: "no_checkout",
        path: "~/tt-studio",
      }),
    ).toContain("~/tt-studio");
    expect(
      resumeNotReadyNotice("QuietBox", {
        kind: "python_too_old",
        found: "3.10.2",
        required: "3.12",
      }),
    ).toContain("3.10.2");
  });

  it("always names the machine", () => {
    const kinds = [
      { kind: "down" as const },
      { kind: "no_checkout" as const, path: "p" },
      { kind: "python_missing" as const, message: "m" },
    ];
    for (const kind of kinds) {
      expect(resumeNotReadyNotice("QuietBox", kind)).toContain("QuietBox");
    }
  });
});

describe("resume port notices", () => {
  it("reports blocked ports without pretending to know the holder", () => {
    const one = resumeBlockedNotice("QuietBox", [{ port: 3000 }]);
    expect(one).toContain("port 3000");
    expect(one).toContain("is in use");
    const many = resumeBlockedNotice("QuietBox", [
      { port: 3000 },
      { port: 8000 },
    ]);
    expect(many).toContain("ports 3000, 8000");
    expect(many).toContain("are in use");
  });

  it("names the holders the pre-flight could not clear", () => {
    const notice = portClearNotice({
      freed: [],
      skipped: [
        {
          port: 3000,
          holder: { pid: 4417, name: "node" },
          class: { kind: "unknown" },
        },
      ],
    });
    expect(notice).toContain("port 3000");
    expect(notice).toContain("held by node");
  });

  it("stays vague when the holder is unknown", () => {
    const notice = portClearNotice({
      freed: [],
      skipped: [{ port: 3000, class: { kind: "unknown" } }],
    });
    expect(notice).toContain("port 3000");
    expect(notice).not.toContain("held by");
  });
});
