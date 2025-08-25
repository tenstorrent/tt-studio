// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { cn } from "../../lib/utils";
import { Card } from "./card";

type Accent = "neutral" | "purple" | "blue" | "amber" | "green";
type Depth = "sm" | "md" | "lg";

export interface ElevatedCardProps extends React.ComponentProps<typeof Card> {
  accent?: Accent;
  depth?: Depth;
  hover?: boolean;
}

const accentClasses: Record<Accent, string> = {
  neutral:
    "border-stone-200 dark:border-stone-800 bg-white/85 dark:bg-stone-950/80",
  purple:
    "border-TT-purple/30 dark:border-TT-purple/40 bg-white/85 dark:bg-stone-950/80",
  blue: "border-TT-blue/30 dark:border-TT-blue/40 bg-white/85 dark:bg-stone-950/80",
  amber:
    "border-amber-500/30 dark:border-amber-400/30 bg-white/85 dark:bg-stone-950/80",
  green:
    "border-green-400/30 dark:border-green-500/30 bg-white/85 dark:bg-stone-950/80",
};

const depthClasses: Record<Depth, string> = {
  sm: "shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_6px_18px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_24px_rgba(0,0,0,0.5)]",
  md: "shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_10px_28px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_14px_36px_rgba(0,0,0,0.6)]",
  lg: "shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_16px_44px_rgba(0,0,0,0.12)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_56px_rgba(0,0,0,0.7)]",
};

export const ElevatedCard = React.forwardRef<HTMLDivElement, ElevatedCardProps>(
  (
    { className, accent = "neutral", depth = "md", hover = false, ...props },
    ref
  ) => {
    return (
      <Card
        ref={ref}
        className={cn(
          "rounded-xl border-[2.5px] backdrop-blur-sm transition-shadow duration-300",
          "bg-gradient-to-br from-white/70 to-white/40 dark:from-stone-900/60 dark:to-stone-950/50",
          accentClasses[accent],
          depthClasses[depth],
          hover &&
            "hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_18px_48px_rgba(0,0,0,0.14)] dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_66px_rgba(0,0,0,0.75)]",
          className
        )}
        {...props}
      />
    );
  }
);

ElevatedCard.displayName = "ElevatedCard";

export default ElevatedCard;

