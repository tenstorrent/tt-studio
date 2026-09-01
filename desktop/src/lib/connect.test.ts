// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from "vitest";
import {
  blockedPorts,
  classificationCard,
  describeStep,
  portConflictCard,
} from "./connect";
import type { PortHolder, Profile, TunnelStatus } from "./ipc";

const profile: Profile = {
  id: "p1",
  name: "QuietBox",
  kind: "ssh",
  host: "qb2.lan",
  user: "jashan",
  auth: { method: "agent" },
};

function connected(
  forwards: Array<{ port: number; active: boolean; holder?: PortHolder }>,
): TunnelStatus {
  return {
    phase: { state: "connected" },
    forwards: forwards.map(({ port, active, holder }) => ({
      local_port: port,
      remote_port: port,
      active,
      holder,
    })),
  };
}

describe("blockedPorts", () => {
  it("reports essential ports whose local listener failed to bind", () => {
    const status = connected([
      { port: 3000, active: false },
      { port: 8000, active: true },
      { port: 8001, active: false },
    ]);
    expect(blockedPorts(status).map((b) => b.port)).toEqual([3000, 8001]);
  });

  it("carries the holder the backend probed for each blocked port", () => {
    const status = connected([
      { port: 3000, active: false, holder: { pid: 95452, name: "ssh" } },
    ]);
    expect(blockedPorts(status)[0].holder).toEqual({
      pid: 95452,
      name: "ssh",
    });
  });

  it("ignores the model container port range", () => {
    const status = connected([
      { port: 3000, active: true },
      { port: 7005, active: false },
    ]);
    expect(blockedPorts(status)).toEqual([]);
  });

  it("is empty while not connected", () => {
    expect(blockedPorts(null)).toEqual([]);
    expect(
      blockedPorts({ phase: { state: "connecting" }, forwards: [] }),
    ).toEqual([]);
  });
});

describe("portConflictCard", () => {
  const ssh: PortHolder = { pid: 95452, name: "ssh" };

  it("gives 3000 the dev-server guidance when the holder is unknown", () => {
    const card = portConflictCard([{ port: 3000 }, { port: 8000 }]);
    expect(card.title).toBe("Port 3000 is already in use");
    expect(card.body).toContain("Another TT-Studio or dev server");
    expect(card.hint).toContain("run.py --stop");
    expect(card.command).toBeUndefined();
  });

  it("names the process holding 3000 and offers to kill it", () => {
    const card = portConflictCard([{ port: 3000, holder: ssh }]);
    expect(card.body).toContain("held by ssh (pid 95452)");
    expect(card.body).not.toContain("Another TT-Studio or dev server");
    expect(card.command).toBe("kill 95452");
    expect(card.hint).toContain("LocalForward");
  });

  it("offers one kill when a single process holds every blocked port", () => {
    const card = portConflictCard([
      { port: 3000, holder: ssh },
      { port: 8000, holder: ssh },
    ]);
    expect(card.command).toBe("kill 95452");
  });

  it("offers no kill when the blocked ports have different holders", () => {
    const card = portConflictCard([
      { port: 3000, holder: ssh },
      { port: 8000, holder: { pid: 12, name: "node" } },
    ]);
    expect(card.command).toBeUndefined();
  });

  it("offers no kill when only some blocked ports have a known holder", () => {
    const card = portConflictCard([
      { port: 3000, holder: ssh },
      { port: 8000 },
    ]);
    expect(card.command).toBeUndefined();
  });

  it("names the taken ports when 3000 is fine", () => {
    const card = portConflictCard([{ port: 8001 }, { port: 8002 }]);
    expect(card.title).toContain("8001, 8002");
    expect(card.body).not.toContain("Held by");
  });

  it("names the holders of non-3000 ports once each", () => {
    const card = portConflictCard([
      { port: 8001, holder: ssh },
      { port: 8002, holder: ssh },
    ]);
    expect(card.body).toContain("Held by ssh (pid 95452).");
  });
});

describe("classificationCard", () => {
  it("turns no_checkout into clone instructions with the profile's path", () => {
    const card = classificationCard(
      { kind: "no_checkout", path: "~/tt-studio" },
      profile,
    );
    expect(card?.title).toContain("QuietBox");
    expect(card?.command).toContain("git clone");
    expect(card?.command).toContain("jashan@qb2.lan");
    expect(card?.command).toContain("~/tt-studio");
    expect(card?.showEdit).toBe(true);
  });

  it("explains an old python with found and required versions", () => {
    const card = classificationCard(
      { kind: "python_too_old", found: "Python 3.10.4", required: "3.12" },
      profile,
    );
    expect(card?.body).toContain("Python 3.10.4");
    expect(card?.body).toContain("3.12");
  });

  it("explains a missing python", () => {
    const card = classificationCard(
      { kind: "python_missing", message: "sh: python3: not found" },
      profile,
    );
    expect(card?.body).toContain("python3: not found");
  });

  it("returns null for states the flow proceeds from", () => {
    expect(classificationCard({ kind: "healthy" }, profile)).toBeNull();
    expect(classificationCard({ kind: "down" }, profile)).toBeNull();
    expect(
      classificationCard(
        { kind: "partial", healthy: ["frontend"], unhealthy: ["backend"] },
        profile,
      ),
    ).toBeNull();
  });
});

describe("describeStep", () => {
  it("names the machine in every stage", () => {
    for (const step of ["tunnel", "classify", "bringup", "attach"] as const) {
      expect(describeStep(step, "QuietBox")).toContain("QuietBox");
    }
  });
});
