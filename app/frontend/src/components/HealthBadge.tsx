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

interface HealthBadgeProps {
  health: string;
}

const HealthBadge: React.FC<HealthBadgeProps> = ({ health }) => {
  const healthColor = (() => {
    switch (health.toLowerCase()) {
      case "healthy":
        return "bg-green-500";
      case "unhealthy":
        return "bg-red-500";
      default:
        return "bg-yellow-500";
    }
  })();

  const variant = (() => {
    switch (health.toLowerCase()) {
      case "healthy":
        return "default";
      case "unhealthy":
        return "destructive";
      default:
        return "warning";
    }
  })();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Badge statusColor={healthColor} variant={variant}>
              {health}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Docker Container Health: {health} (refreshed every 6 minutes)</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default HealthBadge;
