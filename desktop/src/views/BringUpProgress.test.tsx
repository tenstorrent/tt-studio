// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BringUpProgress from "./BringUpProgress";
import { reduceStream } from "../lib/events";
import {
  FAILURE_STREAM,
  PROMPT_BLOCKED_STREAM,
  SUCCESS_STREAM,
} from "../lib/events.test";

afterEach(cleanup);

describe("BringUpProgress", () => {
  it("renders the phase stepper with notes and warnings for a success", () => {
    const state = reduceStream(SUCCESS_STREAM);
    const onReady = vi.fn();
    render(<BringUpProgress state={state} onReady={onReady} />);

    expect(screen.getByTestId("phase-Checks").textContent).toContain("1/5");
    // The Pull phase was renamed to Build mid-run.
    expect(screen.getByTestId("phase-Build")).toBeTruthy();
    expect(screen.queryByTestId("phase-Pull")).toBeNull();
    expect(screen.getByText("image pull skipped (cached)")).toBeTruthy();
    expect(screen.getByTestId("bringup-warning").textContent).toContain(
      "HF_TOKEN",
    );
    expect(screen.getByText(/opening/i)).toBeTruthy();
  });

  it("calls onReady with the app url once the launcher reports ready", () => {
    const onReady = vi.fn();
    render(
      <BringUpProgress state={reduceStream(SUCCESS_STREAM)} onReady={onReady} />,
    );
    expect(onReady).toHaveBeenCalledWith("http://localhost:3000");
  });

  it("does not call onReady while still running or after a failure", () => {
    const onReady = vi.fn();
    const { unmount } = render(
      <BringUpProgress state={reduceStream(FAILURE_STREAM)} onReady={onReady} />,
    );
    expect(onReady).not.toHaveBeenCalled();
    unmount();
  });

  it("renders an error card with remediation on failure", () => {
    const state = reduceStream(FAILURE_STREAM);
    render(<BringUpProgress state={state} onReady={() => {}} />);

    const card = screen.getByTestId("bringup-error");
    expect(card.textContent).toContain("port 8001");
    expect(card.textContent).toContain("python run.py --stop");
    expect(card.textContent).toContain("fastapi.log");
    expect(screen.getByTestId("phase-Launch").textContent).toContain("✕");
  });

  it("explains a blocked prompt with its remediation", () => {
    const state = reduceStream(PROMPT_BLOCKED_STREAM);
    render(<BringUpProgress state={state} onReady={() => {}} />);

    const card = screen.getByTestId("bringup-prompt-blocked");
    expect(card.textContent).toContain("Hugging Face");
    expect(card.textContent).toContain("HF_TOKEN");
  });
});
