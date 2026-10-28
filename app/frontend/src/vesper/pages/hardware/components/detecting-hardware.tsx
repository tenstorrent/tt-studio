// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ReactNode } from "react";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";

/** A pulsing grid with a label, shown in place of the cards while busy. */
function HardwareProgress({
  label,
  description,
}: {
  label: string;
  description?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex-1 flex flex-col items-center justify-center gap-vesper-4 p-vesper-10 text-center"
    >
      <div className="flex items-center gap-vesper-4">
        <div className="w-6 h-6 grid grid-cols-3 gap-px p-px" aria-hidden>
          {Array.from({ length: 9 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "rounded-[1px] bg-vesper-text-primary animate-pulse",
                i % 2 === 0 ? "opacity-20" : "opacity-90"
              )}
              style={{ animationDelay: `${(i % 3) * 150}ms` }}
            />
          ))}
        </div>
        <Typography
          variant="label-md-mono"
          className="uppercase tracking-vesper-wide text-vesper-text-secondary"
        >
          {label}
        </Typography>
      </div>
      {description && (
        <Typography
          variant="copy-sm"
          className="max-w-md text-vesper-text-secondary"
        >
          {description}
        </Typography>
      )}
    </div>
  );
}

/** Shown while the first hardware scan is in flight. */
export function DetectingHardware() {
  return <HardwareProgress label="Detecting hardware" />;
}

/**
 * Shown while a board or device reset is running. The backend reports no
 * devices until the reset finishes, so this replaces the cards entirely.
 */
export function ResettingHardware() {
  return (
    <HardwareProgress
      label="Resetting hardware"
      description="A board reset is in progress. This takes about a minute or two; your devices will reappear here once it finishes."
    />
  );
}
