// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    // The launcher's remediation is a sentence — it must be readable text,
    // not something offered for pasting into a shell.
    expect(card.textContent).toContain("set HF_TOKEN in .env");
  });

  it("copies a command you can actually run, not the prose", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      render(
        <BringUpProgress
          state={reduceStream(PROMPT_BLOCKED_STREAM)}
          machine={{ host: "qb2.lan", user: "jashan", repoPath: "~/tt-studio" }}
          onReady={() => {}}
        />,
      );
      const button = screen.getByTestId("copy-remediation");
      fireEvent.click(button);
      // Aimed at the machine that runs it, not the user's laptop.
      expect(writeText).toHaveBeenCalledWith(
        "ssh jashan@qb2.lan -t 'cd ~/tt-studio && python run.py'",
      );
      await waitFor(() => expect(button.textContent).toBe("Copied"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe("the first-run terms gate", () => {
    const TERMS_STREAM = [
      `{"v": 1, "ts": 1.0, "event": "phase_begin", "phase": "Configure", "detail": {"index": 2, "total": 5}}`,
      `{"v": 1, "ts": 2.0, "event": "prompt_blocked", "phase": "Configure", "detail": {"prompt": "Do you agree to these terms?", "remediation": "this run needs interactive input"}}`,
    ].join("\n");

    it("lets the user agree in the app instead of in a terminal", () => {
      const onAcceptTerms = vi.fn();
      render(
        <BringUpProgress
          state={reduceStream(TERMS_STREAM)}
          onAcceptTerms={onAcceptTerms}
          onReady={() => {}}
        />,
      );
      const card = screen.getByTestId("bringup-prompt-blocked");
      expect(card.textContent).toContain("OS Model Terms");
      // No terminal instructions: the question is answerable right here.
      expect(screen.queryByTestId("copy-remediation")).toBeNull();
      fireEvent.click(screen.getByTestId("bringup-accept-terms"));
      expect(onAcceptTerms).toHaveBeenCalledOnce();
    });

    it("offers the full terms to read first", () => {
      const onOpenTerms = vi.fn();
      render(
        <BringUpProgress
          state={reduceStream(TERMS_STREAM)}
          onAcceptTerms={() => {}}
          onOpenTerms={onOpenTerms}
          onReady={() => {}}
        />,
      );
      fireEvent.click(screen.getByTestId("bringup-read-terms"));
      expect(onOpenTerms).toHaveBeenCalledOnce();
    });

    it("falls back to the terminal when the app can't answer it", () => {
      // No onAcceptTerms wired (e.g. a build without the retry path): the
      // user must still be told how to get past it.
      render(
        <BringUpProgress state={reduceStream(TERMS_STREAM)} onReady={() => {}} />,
      );
      expect(screen.queryByTestId("bringup-accept-terms")).toBeNull();
      expect(screen.getByTestId("copy-remediation")).toBeTruthy();
    });
  });
});
