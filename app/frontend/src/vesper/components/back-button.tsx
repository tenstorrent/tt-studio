// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button } from "@tenstorrent/vesper/button";
import { ArrowLeft } from "@tenstorrent/vesper/icons";

/** The `← BACK` button shown at the top-left of drill-down views. */
export function BackButton({
  onClick,
  children = "Back",
  className,
}: {
  onClick(): void;
  children?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="subtle"
      iconLeft={<ArrowLeft />}
      onClick={onClick}
      className={className}
    >
      {children}
    </Button>
  );
}
