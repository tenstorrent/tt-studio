// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShellUpdate } from "../lib/updates";
import UpdateBanner from "./UpdateBanner";

afterEach(cleanup);

const update = (install = vi.fn(() => new Promise<void>(() => {}))) =>
  ({ version: "2.11.0", install }) as ShellUpdate;

describe("UpdateBanner", () => {
  it("offers install when the launch check finds an update", async () => {
    render(<UpdateBanner checkUpdate={async () => update()} />);
    await waitFor(() => screen.getByTestId("update-banner"));
    expect(screen.getByText(/2\.11\.0 is available/)).toBeTruthy();
  });

  it("shows up-to-date after a check with no update", async () => {
    render(<UpdateBanner checkUpdate={async () => null} />);
    await waitFor(() => screen.getByTestId("update-current"));
  });

  it("stays quiet when the launch check fails (offline)", async () => {
    render(<UpdateBanner checkUpdate={async () => Promise.reject("net down")} />);
    await waitFor(() => screen.getByTestId("update-check"));
    expect(screen.queryByTestId("update-error")).toBeNull();
  });

  it("surfaces a manual check failure", async () => {
    let calls = 0;
    render(
      <UpdateBanner
        checkUpdate={() => {
          calls += 1;
          return Promise.reject("net down");
        }}
      />,
    );
    await waitFor(() => screen.getByTestId("update-check"));
    fireEvent.click(screen.getByTestId("update-check"));
    await waitFor(() => screen.getByTestId("update-error"));
    expect(calls).toBe(2);
  });

  it("disables the install button while installing", async () => {
    const install = vi.fn(() => new Promise<void>(() => {}));
    render(<UpdateBanner checkUpdate={async () => update(install)} />);
    await waitFor(() => screen.getByTestId("update-install"));
    fireEvent.click(screen.getByTestId("update-install"));
    expect(install).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        (screen.getByTestId("update-install") as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });
});
