// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useState } from "react";
import {
  BarChart2,
  Clock,
  Zap,
  Hash,
  AlignJustify,
  FileText,
  Maximize,
  Minimize,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { InferenceStatsProps } from "./types";

export default function Component({ stats }: InferenceStatsProps) {
  console.log(stats);
  const [showFullText, setShowFullText] = useState(false);

  if (!stats) return null;

  const toggleFullText = () => setShowFullText(!showFullText);

  const formatValue = (value: number | undefined, decimals: number = 2) => {
    return typeof value === "number" ? value.toFixed(decimals) : "N/A";
  };

  const statItems = [
    {
      icon: <Clock className="h-4 w-4" />,
      abbr: "TTFT",
      full: "Time to First Token",
      value: `${formatValue(stats.user_ttft_s)}s`,
    },
    {
      icon: <Zap className="h-4 w-4" />,
      abbr: "TPOT",
      full: "Time Per Output Token",
      value: `${formatValue(stats.user_tpot, 6)}s`,
    },
    {
      icon: <Hash className="h-4 w-4" />,
      abbr: "Decoded",
      full: "Tokens Decoded",
      value: stats.tokens_decoded,
    },
    {
      icon: <FileText className="h-4 w-4" />,
      abbr: "Prefilled",
      full: "Tokens Prefilled",
      value: stats.tokens_prefilled,
    },
    {
      icon: <AlignJustify className="h-4 w-4" />,
      abbr: "Context",
      full: "Context Length",
      value: stats.context_length,
    },
  ];

  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-500 p-1 h-auto hover:bg-black/10"
            >
              <BarChart2 className="h-4 w-4" />
              <span className="sr-only">Show Inference Stats</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent
            className="bg-gradient-to-b from-black/95 to-black/90 text-white border border-gray-700 p-4 rounded-lg shadow-lg"
            style={{
              boxShadow:
                "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.1) inset",
            }}
            sideOffset={5}
          >
            <div className="text-xs space-y-2">
              <div className="text-sm font-bold mb-2 flex justify-between items-center gap-4">
                <span>Inference Statistics</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleFullText}
                        className="text-white hover:bg-white/20 p-1"
                        aria-label={
                          showFullText
                            ? "Show abbreviated labels"
                            : "Show full labels"
                        }
                      >
                        {showFullText ? (
                          <Minimize className="h-4 w-4" />
                        ) : (
                          <Maximize className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="bg-black/80 text-white text-xs p-2"
                    >
                      {showFullText
                        ? "Show abbreviated labels"
                        : "Show full labels"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="space-y-1">
                {statItems.map((item, index) => (
                  <div
                    key={index}
                    className="flex justify-between items-center whitespace-nowrap"
                  >
                    <div className="flex items-center gap-2">
                      {item.icon} {showFullText ? item.full : item.abbr}:
                    </div>
                    <div className="ml-4 tabular-nums">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
