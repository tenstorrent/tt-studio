// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getResumeOnLaunch = vi.fn();
const setResumeOnLaunch = vi.fn((_enabled: boolean) => Promise.resolve());

vi.mock("../lib/ipc", () => ({
  getResumeOnLaunch: () => getResumeOnLaunch(),
  setResumeOnLaunch: (enabled: boolean) => setResumeOnLaunch(enabled),
}));

import ResumeSetting from "./ResumeSetting";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ResumeSetting", () => {
  it("loads the stored preference", async () => {
    getResumeOnLaunch.mockResolvedValue(false);
    render(<ResumeSetting />);
    await waitFor(() => screen.getByTestId("resume-on-launch"));
    expect(
      (screen.getByTestId("resume-on-launch") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("persists a change", async () => {
    getResumeOnLaunch.mockResolvedValue(true);
    render(<ResumeSetting />);
    await waitFor(() => screen.getByTestId("resume-on-launch"));
    fireEvent.click(screen.getByTestId("resume-on-launch"));
    expect(setResumeOnLaunch).toHaveBeenCalledWith(false);
  });

  it("shows what the app will actually do when the store is unreadable", async () => {
    getResumeOnLaunch.mockRejectedValue("no store");
    render(<ResumeSetting />);
    await waitFor(() => screen.getByTestId("resume-on-launch"));
    expect(
      (screen.getByTestId("resume-on-launch") as HTMLInputElement).checked,
    ).toBe(true);
  });
});
