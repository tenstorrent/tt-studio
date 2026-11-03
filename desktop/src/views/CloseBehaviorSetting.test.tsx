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
import CloseBehaviorSetting from "./CloseBehaviorSetting";

const getCloseBehavior = vi.fn();
const setCloseBehavior = vi.fn();

vi.mock("../lib/ipc", () => ({
  getCloseBehavior: (...args: unknown[]) => getCloseBehavior(...args),
  setCloseBehavior: (...args: unknown[]) => setCloseBehavior(...args),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CloseBehaviorSetting", () => {
  it("loads and shows the stored behavior", async () => {
    getCloseBehavior.mockResolvedValue("minimize_to_tray");
    render(<CloseBehaviorSetting />);
    await waitFor(() =>
      expect(
        (screen.getByTestId("close-behavior") as HTMLSelectElement).value,
      ).toBe("minimize_to_tray"),
    );
  });

  it("persists a new choice", async () => {
    getCloseBehavior.mockResolvedValue("ask");
    setCloseBehavior.mockResolvedValue(undefined);
    render(<CloseBehaviorSetting />);
    await waitFor(() => screen.getByTestId("close-behavior"));

    fireEvent.change(screen.getByTestId("close-behavior"), {
      target: { value: "stop_stack" },
    });
    expect(setCloseBehavior).toHaveBeenCalledWith("stop_stack");
  });

  it("falls back to ask when the store is unreadable", async () => {
    getCloseBehavior.mockRejectedValue(new Error("no store"));
    render(<CloseBehaviorSetting />);
    await waitFor(() =>
      expect(
        (screen.getByTestId("close-behavior") as HTMLSelectElement).value,
      ).toBe("ask"),
    );
  });
});
