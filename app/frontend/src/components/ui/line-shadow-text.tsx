// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cn } from "../../lib/utils";
import { motion, MotionProps } from "framer-motion";

interface LineShadowTextProps
  extends Omit<React.HTMLAttributes<HTMLElement>, keyof MotionProps>,
    MotionProps {
  shadowColor?: string;
  as?: React.ElementType;
  children?: React.ReactNode;
  className?: string;
}

export function LineShadowText({
  children,
  shadowColor = "black",
  className,
  as: Component = "span",
  ...props
}: LineShadowTextProps) {
  const MotionComponent = motion(Component);
  const content = typeof children === "string" ? children : null;

  if (!content) {
    throw new Error("LineShadowText only accepts string content");
  }

  return (
    <MotionComponent
      style={
        {
          "--shadow-color": shadowColor,
          "--stripe-size": "0.15em",
          "--offset": "0.05em",
        } as React.CSSProperties
      }
      className={cn(
        "relative inline-block",
        // Main text
        "before:absolute before:inset-0 before:content-[attr(data-text)]",
        "before:z-[2] before:text-current",
        "before:text-shadow-[0_0_20px_rgba(255,255,255,0.3)]",
        // Shadow layer
        "after:absolute after:inset-0 after:content-[attr(data-text)]",
        "after:z-[1] after:translate-x-[calc(var(--offset)*1.5)] after:translate-y-[calc(var(--offset)*1.5)]",
        "after:bg-[repeating-linear-gradient(-45deg,var(--shadow-color),var(--shadow-color)_calc(var(--stripe-size)*1.5),transparent_calc(var(--stripe-size)*1.5),transparent_calc(var(--stripe-size)*3))]",
        "after:bg-clip-text after:text-transparent",
        "after:animate-line-shadow",
        className
      )}
      data-text={content}
      {...props}
    >
      <span className="opacity-0">{content}</span>
    </MotionComponent>
  );
}
