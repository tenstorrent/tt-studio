// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import { BarChart2, Clock, Zap, Hash, AlignJustify } from "lucide-react";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

interface InferenceStats {
  user_ttft_ms: number;
  user_tps: number;
  tokens_decoded: number;
  tokens_prefilled: number;
  context_length: number;
}

interface InferenceStatsProps {
  stats: InferenceStats;
}

export default function InferenceStats({ stats }: InferenceStatsProps) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center">
                <BarChart2 className="h-4 w-4" />
                <span className="sr-only">Show Inference Stats</span>
              </div>
            </TooltipTrigger>
            <TooltipContent align="end" className="flex flex-col gap-2">
              <div className="text-xs space-y-2">
                <div className="font-semibold">Inference Statistics</div>
                <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 items-center">
                  <div className="flex items-center whitespace-nowrap">
                    <Clock className="h-3 w-3 mr-1" /> TTFT:
                  </div>
                  <div className="text-right">
                    {stats.user_ttft_ms.toFixed(2)}s
                  </div>

                  <div className="flex items-center whitespace-nowrap">
                    <Zap className="h-3 w-3 mr-1" /> TPOT:
                  </div>
                  <div className="text-right">{stats.user_tps.toFixed(6)}s</div>

                  <div className="flex items-center whitespace-nowrap">
                    <Hash className="h-3 w-3 mr-1" /> Decoded:
                  </div>
                  <div className="text-right">{stats.tokens_decoded}</div>

                  <div className="flex items-center whitespace-nowrap">
                    <Hash className="h-3 w-3 mr-1" /> Prefilled:
                  </div>
                  <div className="text-right">{stats.tokens_prefilled}</div>

                  <div className="flex items-center whitespace-nowrap">
                    <AlignJustify className="h-3 w-3 mr-1" /> Context:
                  </div>
                  <div className="text-right">{stats.context_length}</div>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </Button>
    </div>
  );
}
