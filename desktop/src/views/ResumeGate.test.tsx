// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResumeGate from "./ResumeGate";

afterEach(cleanup);

const base = {
  machine: "QuietBox",
  age: null,
  activity: "Opening SSH tunnel to QuietBox…",
  onCancel: () => {},
  onPickAnother: () => {},
};

describe("ResumeGate", () => {
  it("names the machine it is reconnecting to", () => {
    render(<ResumeGate {...base} />);
    expect(screen.getByText("Reconnecting to QuietBox…")).toBeTruthy();
    expect(screen.getByTestId("resume-activity").textContent).toContain(
      "Opening SSH tunnel",
    );
  });

  it("says how long ago the stack was left running", () => {
    render(<ResumeGate {...base} age="40m" />);
    expect(screen.getByTestId("resume-subline").textContent).toContain(
      "40m ago",
    );
  });

  it("stays honest when the age is unknown", () => {
    render(<ResumeGate {...base} />);
    const line = screen.getByTestId("resume-subline").textContent ?? "";
    expect(line).toContain("Picking up where you left off");
    expect(line).not.toContain("ago");
  });

  it("always offers both ways out", () => {
    const onCancel = vi.fn();
    const onPickAnother = vi.fn();
    render(
      <ResumeGate
        {...base}
        onCancel={onCancel}
        onPickAnother={onPickAnother}
      />,
    );
    fireEvent.click(screen.getByTestId("resume-cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("resume-pick-another"));
    expect(onPickAnother).toHaveBeenCalledOnce();
  });
});
