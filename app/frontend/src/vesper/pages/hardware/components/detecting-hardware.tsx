// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";

/** Shown while the first hardware scan is in flight. */
export function DetectingHardware() {
  return (
    <div
      role="status"
      className="flex-1 flex items-center justify-center gap-vesper-4 p-vesper-10"
    >
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
        Detecting hardware
      </Typography>
    </div>
  );
}
