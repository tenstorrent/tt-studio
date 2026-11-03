// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConnectErrorCard from "./ConnectErrorCard";

afterEach(cleanup);

describe("ConnectErrorCard", () => {
  it("renders title, body, command and hint", () => {
    render(
      <ConnectErrorCard
        card={{
          title: "TT-Studio isn't set up on QuietBox",
          body: "There is no run.py at ~/tt-studio.",
          command: "git clone https://github.com/tenstorrent/tt-studio.git",
          hint: "Then connect again.",
          showEdit: true,
        }}
        onBack={() => {}}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByText("TT-Studio isn't set up on QuietBox")).toBeTruthy();
    expect(screen.getByText(/no run\.py/)).toBeTruthy();
    expect(screen.getByText(/git clone/)).toBeTruthy();
    expect(screen.getByText("Then connect again.")).toBeTruthy();
  });

  it("wires back, and edit only when the card asks for it", () => {
    const onBack = vi.fn();
    const onEdit = vi.fn();
    const { rerender } = render(
      <ConnectErrorCard
        card={{ title: "t", body: "b", showEdit: true }}
        onBack={onBack}
        onEdit={onEdit}
      />,
    );
    fireEvent.click(screen.getByTestId("connect-error-edit"));
    expect(onEdit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("connect-error-back"));
    expect(onBack).toHaveBeenCalledOnce();

    rerender(
      <ConnectErrorCard
        card={{ title: "t", body: "b" }}
        onBack={onBack}
        onEdit={onEdit}
      />,
    );
    expect(screen.queryByTestId("connect-error-edit")).toBeNull();
  });
});
