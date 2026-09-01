// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from "vitest";
import { describeSession, describeSessionAge } from "./session";

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
