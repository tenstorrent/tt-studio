// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stackSkipNotice } from "../lib/updates";
import { StackSwitchProgress, StackUpdatePrompt } from "./StackUpdateCard";

afterEach(cleanup);

describe("StackUpdatePrompt", () => {
  it("names both versions and routes the two choices", () => {
    const onUpdate = vi.fn();
    const onSkip = vi.fn();
    render(
      <StackUpdatePrompt
        from="v2.9.0"
        to="v2.10.0"
        machine="QuietBox"
        onUpdate={onUpdate}
        onSkip={onSkip}
      />,
    );
    expect(
      screen.getByTestId("stack-update-versions").textContent,
    ).toContain("QuietBox is on v2.9.0");
    fireEvent.click(screen.getByTestId("stack-update-now"));
    expect(onUpdate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("stack-update-skip"));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("says 'your stack' for the local target", () => {
    render(
      <StackUpdatePrompt
        from="v2.9.0"
        to="v2.10.0"
        machine={null}
        onUpdate={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(
      screen.getByTestId("stack-update-versions").textContent,
    ).toContain("Your stack is on v2.9.0");
  });
});

describe("StackSwitchProgress", () => {
  it("streams switch output lines", () => {
    render(
      <StackSwitchProgress to="v2.10.0" lines={["Fetching origin", "done"]} />,
    );
    expect(screen.getByTestId("stack-switch-lines").textContent).toBe(
      "Fetching origin\ndone",
    );
  });
});

describe("stackSkipNotice", () => {
  it("explains developer and offline skips, stays quiet otherwise", () => {
    expect(stackSkipNotice("dirty_checkout")).toMatch(/Developer checkout/);
    expect(stackSkipNotice("not_on_release")).toMatch(/Developer checkout/);
    expect(stackSkipNotice("offline")).toMatch(/current version/);
    expect(stackSkipNotice("up_to_date")).toBeNull();
    expect(stackSkipNotice("policy_never")).toBeNull();
    expect(stackSkipNotice("no_checkout")).toBeNull();
  });
});
