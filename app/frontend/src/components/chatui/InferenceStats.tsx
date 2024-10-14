// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import {
  BarChart2,
  Clock,
  Zap,
  Hash,
  Layers,
  AlignJustify,
} from "lucide-react";
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
  user_ttft_e2e_ms: number;
  prefill: {
    tokens_prefilled: number;
    tps: number;
  };
  decode: {
    tokens_decoded: number;
    tps: number;
  };
  batch_size: number;
  context_length: number;
}

interface InferenceStatsProps {
  stats: InferenceStats;
}

export default function Component({ stats }: InferenceStatsProps) {
  return (
    <div className="text-xs text-gray-500 mt-1 self-end">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-500 p-1 h-auto"
            >
              <BarChart2 className="h-4 w-4" />
              <span className="sr-only">Show Inference Stats</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs space-y-1">
              <div className="font-semibold mb-2">Inference Statistics</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="flex items-center">
                  <Clock className="h-3 w-3 mr-1" /> TTFT (User):
                </div>
                <div>{stats.user_ttft_ms} ms</div>
                <div className="flex items-center">
                  <Zap className="h-3 w-3 mr-1" /> TPS (User):
                </div>
                <div>{stats.user_tps}</div>
                <div className="flex items-center">
                  <Clock className="h-3 w-3 mr-1" /> TTFT E2E:
                </div>
                <div>{stats.user_ttft_e2e_ms} ms</div>
                <div className="flex items-center">
                  <Hash className="h-3 w-3 mr-1" /> Tokens Prefilled:
                </div>
                <div>{stats.prefill.tokens_prefilled}</div>
                <div className="flex items-center">
                  <Zap className="h-3 w-3 mr-1" /> Prefill TPS:
                </div>
                <div>{stats.prefill.tps}</div>
                <div className="flex items-center">
                  <Hash className="h-3 w-3 mr-1" /> Tokens Decoded:
                </div>
                <div>{stats.decode.tokens_decoded}</div>
                <div className="flex items-center">
                  <Zap className="h-3 w-3 mr-1" /> Decode TPS:
                </div>
                <div>{stats.decode.tps}</div>
                <div className="flex items-center">
                  <Layers className="h-3 w-3 mr-1" /> Batch Size:
                </div>
                <div>{stats.batch_size}</div>
                <div className="flex items-center">
                  <AlignJustify className="h-3 w-3 mr-1" /> Context Length:
                </div>
                <div>{stats.context_length}</div>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
