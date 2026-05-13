// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import * as React from "react";
import { cn } from "../../lib/utils";

export interface PulsatingDotProps {
  label: string;
  color?: "blue" | "green" | "purple" | "amber";
  size?: "sm" | "md" | "lg";
  delay?: number;
  className?: string;
}

const colorClasses = {
  blue: "bg-blue-500",
  green: "bg-green-500", 
  purple: "bg-purple-500",
  amber: "bg-amber-500",
};

const borderColorClasses = {
  blue: "border-blue-500/50",
  green: "border-green-500/50", 
  purple: "border-purple-500/50",
  amber: "border-amber-500/50",
};

const sizeClasses = {
  sm: "w-2 h-2",
  md: "w-3 h-3", 
  lg: "w-4 h-4",
};

export const PulsatingDot = React.forwardRef<HTMLDivElement, PulsatingDotProps>(
  ({ label, color = "blue", size = "md", delay = 0, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("relative flex items-center justify-center", className)}
        title={label}
        {...props}
      >
        <div
          className={cn(
            "rounded-full animate-pulse",
            colorClasses[color],
            sizeClasses[size]
          )}
          style={{
            animationDelay: `${delay}ms`,
            animationDuration: "2s",
          }}
        />
        {/* Outer ring animation */}
        <div
          className={cn(
            "absolute rounded-full border-2 animate-ping",
            borderColorClasses[color],
            sizeClasses[size]
          )}
          style={{
            animationDelay: `${delay}ms`,
            animationDuration: "2s",
          }}
        />
      </div>
    );
  }
);

PulsatingDot.displayName = "PulsatingDot";