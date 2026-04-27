// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";
import { BugReportModal } from "./BugReportModal";

interface BugReportButtonProps {
  /** "icon" — icon-only button for the navbar; "full" — icon + text for the footer */
  variant?: "icon" | "full";
  className?: string;
}

export function BugReportButton({
  variant = "icon",
  className,
}: BugReportButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={variant === "icon" ? "icon" : "sm"}
            onClick={() => setOpen(true)}
            className={
              variant === "full"
                ? `border border-red-200 hover:border-red-300 hover:bg-red-50 dark:border-red-800 dark:hover:border-red-700 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400 ${className ?? ""}`
                : `hover:bg-gray-100 dark:hover:bg-gray-800 text-muted-foreground hover:text-red-500 ${className ?? ""}`
            }
            aria-label="Report a bug"
          >
            <Bug className={variant === "icon" ? "h-5 w-5" : "h-4 w-4 mr-2"} />
            {variant === "full" && "Report Bug"}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Report a bug — collects logs automatically</p>
        </TooltipContent>
      </Tooltip>

      <BugReportModal open={open} onOpenChange={setOpen} />
    </>
  );
}
