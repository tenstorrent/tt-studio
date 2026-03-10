// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { cn } from "../../lib/utils";
import { MessageSquare } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

interface ConversationCounterProps {
  count: number;
  variant?: "sidebar" | "header" | "minimal";
  className?: string;
  animate?: boolean;
}

export const ConversationCounter: React.FC<ConversationCounterProps> = ({
  count,
  variant = "sidebar",
  className = "",
  animate = false,
}) => {
  const { theme } = useTheme();

  // Determine label based on count
  const label = count === 1 ? "message" : "messages";

  if (variant === "minimal") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center",
          theme === "dark"
            ? "bg-TT-purple-shade/40 text-TT-purple-tint1"
            : "bg-TT-purple/10 text-TT-purple-accent",
          "text-xs font-medium rounded-full px-2 py-0.5",
          animate && count > 0 && "animate-pulse",
          className
        )}
      >
        {count}
      </span>
    );
  }

  if (variant === "header") {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5",
          theme === "dark"
            ? "bg-TT-purple/10 text-TT-purple-tint1 border-TT-purple/30"
            : "bg-TT-purple-shade/20 text-TT-purple border-TT-purple/20",
          "rounded-full px-3 py-1",
          "border shadow-sm",
          animate && count > 0 && "animate-pulse",
          className
        )}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="text-sm font-medium">
          {count} {label}
        </span>
      </div>
    );
  }

  // Default sidebar variant
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1",
        theme === "dark"
          ? "bg-TT-purple/20 text-TT-purple-tint2 border-TT-purple/20"
          : "bg-TT-purple-shade/30 text-TT-purple-tint1 border-TT-purple/10",
        "rounded-md px-2 py-0.5",
        "border shadow-sm",
        animate && count > 0 && "animate-pulse",
        className
      )}
    >
      <MessageSquare className="h-3 w-3" />
      <span className="text-xs font-medium whitespace-nowrap">
        {count} {label}
      </span>
    </div>
  );
};
