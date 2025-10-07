// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import { Badge } from "./ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

interface StatusBadgeProps {
  status: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const statusColor = (() => {
    switch (status.toLowerCase()) {
      case "running":
      case "available":
        return "bg-green-500";
      case "stopped":
      case "not downloaded":
        return "bg-red-500";
      default:
        return "bg-yellow-500";
    }
  })();

  const variant =
    status.toLowerCase() === "running" || status.toLowerCase() === "available"
      ? "default"
      : status.toLowerCase() === "stopped" ||
          status.toLowerCase() === "not downloaded"
        ? "destructive"
        : "warning";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="leading-none">
            <Badge
              statusColor={statusColor}
              variant={variant}
              className="px-3 py-1 text-sm leading-none"
              style={{ minHeight: 28 }}
            >
              {status}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Status: {status}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default StatusBadge;
