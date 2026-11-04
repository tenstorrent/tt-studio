// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ReactNode } from "react";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";

/** The rounded "No Deployment History" style label used for empty states. */
export function EmptyPill({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Typography
      as="span"
      variant="label-md"
      className={cn(
        "inline-flex items-center h-8 px-vesper-3 rounded-full bg-vesper-tint-neutral-300 text-vesper-text-primary",
        className
      )}
    >
      {children}
    </Typography>
  );
}
