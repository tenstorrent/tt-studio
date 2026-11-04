// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cn } from "@/src/lib/utils";

/** Live microphone levels drawn as a row of bars. */
export function LevelMeter({
  levels,
  active,
  className,
}: {
  /** 0-1 per bar */
  levels: number[];
  active: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex items-center justify-center gap-vesper-1 h-10",
        className
      )}
    >
      {levels.map((level, i) => (
        <span
          key={i}
          className={cn(
            "w-1.5 rounded-full transition-[height] duration-75",
            active ? "bg-vesper-sky-500" : "bg-vesper-tint-neutral-400"
          )}
          style={{ height: `${Math.max(6, Math.min(40, 6 + level * 48))}px` }}
        />
      ))}
    </div>
  );
}
