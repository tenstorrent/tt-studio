// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cn } from "@/src/lib/utils";

const DELAYS = [0, 300, 150, 450, 0, 300, 150, 450, 600];

/** A 3x3 grid of blinking cells used as a compact "working on it" indicator. */
export function MatrixLoader({
  className,
  tone = "neutral",
}: {
  className?: string;
  tone?: "neutral" | "accent" | "warning";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid grid-cols-3 gap-px w-4 h-4 shrink-0",
        className
      )}
    >
      {DELAYS.map((delay, i) => (
        <span
          key={i}
          className={cn(
            "rounded-[1px] animate-pulse",
            tone === "accent" && "bg-vesper-icon-accent",
            tone === "warning" && "bg-vesper-icon-warning",
            tone === "neutral" && "bg-vesper-icon-primary"
          )}
          style={{ animationDelay: `${delay}ms`, animationDuration: "1.2s" }}
        />
      ))}
    </span>
  );
}
