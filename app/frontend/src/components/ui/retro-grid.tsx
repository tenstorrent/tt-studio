// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cn } from "../../lib/utils";

interface RetroGridProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  angle?: number; // default 65
  cellSize?: number; // default 60
  opacity?: number; // default 0.5
  lightLineColor?: string; // default for light mode
  darkLineColor?: string; // default for dark mode
}

export function RetroGrid({
  className,
  angle = 65,
  cellSize = 60,
  opacity = 0.5,
  lightLineColor = "rgba(124, 104, 250, 0.15)", // Very subtle purple for light mode
  darkLineColor = "rgba(124, 104, 250, 0.9)", // Keep original dark mode color
  ...props
}: RetroGridProps) {
  const gridStyles = {
    "--grid-angle": `${angle}deg`,
    "--cell-size": `${cellSize}px`,
    "--opacity": opacity,
    "--light-line": lightLineColor,
    "--dark-line": darkLineColor,
  } as React.CSSProperties;

  return (
    <div
      className={cn(
        "pointer-events-none absolute size-full overflow-hidden perspective-[200px] bg-white/90 dark:bg-transparent",
        `opacity-(--opacity)`,
        className
      )}
      style={gridStyles}
      {...props}
    >
      <div className="absolute inset-0 [transform:rotateX(var(--grid-angle))]">
        <div className="animate-grid bg-[linear-gradient(to_right,var(--light-line)_1px,transparent_0),linear-gradient(to_bottom,var(--light-line)_1px,transparent_0)] bg-repeat bg-size-[var(--cell-size)_var(--cell-size)] h-[300vh] inset-[0%_0px] ml-[-200%] origin-[100%_0_0] w-[600vw] dark:bg-[linear-gradient(to_right,var(--dark-line)_1px,transparent_0),linear-gradient(to_bottom,var(--dark-line)_1px,transparent_0)]" />
      </div>

      <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-white/20 to-transparent dark:from-black dark:via-transparent" />
    </div>
  );
}
