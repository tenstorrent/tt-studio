import React from "react";
import { cn } from "../../lib/utils";
import { MessageSquare } from "lucide-react";

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
  // Determine label based on count
  const label = count === 1 ? "message" : "messages";

  if (variant === "minimal") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center",
          "bg-TT-purple/10 dark:bg-TT-purple-shade/40",
          "text-TT-purple-accent dark:text-TT-purple-tint1",
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
          "bg-TT-purple-shade/20 dark:bg-TT-purple/10",
          "text-TT-purple dark:text-TT-purple-tint1",
          "rounded-full px-3 py-1",
          "border border-TT-purple/20 dark:border-TT-purple/30",
          "shadow-sm",
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
        "bg-TT-purple-shade/30 dark:bg-TT-purple/20",
        "text-TT-purple-tint1 dark:text-TT-purple-tint2",
        "rounded-md px-2 py-0.5",
        "border border-TT-purple/10 dark:border-TT-purple/20",
        "shadow-sm",
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
