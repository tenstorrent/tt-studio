
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
        return "bg-green-500";
      case "stopped":
        return "bg-red-500";
      default:
        return "bg-yellow-500";
    }
  })();

  const variant =
    status.toLowerCase() === "running" ? "default" : "destructive";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Badge statusColor={statusColor} variant={variant}>
              {status}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Docker Container Status: {status} (refreshed every 6 minutes)</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default StatusBadge;
