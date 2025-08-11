// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { Button } from "../../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip";
import { Activity, Copy as CopyIcon, ScrollText } from "lucide-react";
import { customToast } from "../../CustomToaster";

interface Props {
  id: string;
  onOpenLogs: (id: string) => void;
}

export default React.memo(function ContainerLogsCell({
  id,
  onOpenLogs,
}: Props) {
  return (
    <div className="flex items-center gap-3">
      {/* Copy control outside the View Logs button for easier click target */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => {
                navigator.clipboard.writeText(id);
                customToast.success("Copied container ID");
              }}
              className="flex items-center gap-2 rounded-lg border border-TT-purple-accent/30 px-2 py-1 text-xs font-mono text-stone-300 hover:text-white hover:border-TT-purple-accent hover:bg-TT-purple-tint2/20 dark:hover:bg-TT-purple-shade/20 transition-colors opacity-0 group-hover:opacity-100"
              title="Copy container ID"
            >
              <span>{id.substring(0, 8)}...</span>
              <CopyIcon className="w-3.5 h-3.5 opacity-80" />
              <span className="sr-only">Copy container ID</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Click to copy full container ID</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* View Logs button remains dedicated for opening dialog */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpenLogs(id)}
        className="group h-auto p-3 flex items-center gap-3 border-TT-purple/30 hover:border-TT-purple-accent hover:bg-TT-purple-tint2/20 dark:hover:bg-TT-purple-shade/20 hover:shadow-lg hover:shadow-TT-purple/20 transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 min-w-[160px] rounded-xl"
      >
        <div className="relative w-9 h-9 rounded-lg border border-TT-purple-accent/40 bg-gradient-to-br from-TT-purple-tint2/25 to-transparent dark:from-TT-purple-shade/30 dark:to-transparent flex items-center justify-center">
          <ScrollText className="w-4 h-4 text-TT-purple-accent" />
          <Activity className="w-3 h-3 text-TT-purple-accent absolute -bottom-1 -right-1 drop-shadow-sm" />
        </div>
        <span className="text-sm text-TT-purple-accent dark:text-TT-purple font-medium group-hover:text-TT-purple-shade dark:group-hover:text-TT-purple-tint1 transition-colors duration-200">
          View Logs
        </span>
      </Button>
    </div>
  );
});
