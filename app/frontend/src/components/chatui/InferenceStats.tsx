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
  Gauge,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "../ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import type { InferenceStatsProps } from "./types";

export default function Component({ stats }: InferenceStatsProps) {
  const [open, setOpen] = useState(false);

  if (!stats) return null;

  const formatValue = (value: number | undefined, decimals = 2) => {
    return typeof value === "number" ? value.toFixed(decimals) : "N/A";
  };

  const userTPS =
    typeof stats.user_tpot === "number"
      ? (1 / Math.max(stats.user_tpot, 0.000001)).toFixed(2)
      : "N/A";

  const sections = [
    {
      title: "Time Metrics",
      stats: [
        {
          icon: <Clock className="h-5 w-5 text-TT-purple-accent" />,
          value: formatValue(stats.user_ttft_s),
          label: "Time to First Token",
          unit: "s",
        },
        {
          icon: <Zap className="h-5 w-5 text-TT-purple-accent" />,
          value: formatValue(stats.user_tpot, 6),
          label: "Time Per Output Token",
          unit: "s",
        },
        {
          icon: <Gauge className="h-5 w-5 text-TT-purple-accent" />,
          value: userTPS,
          label: "User Tokens Per Second",
          unit: "",
        },
      ],
    },
    {
      title: "Token Metrics",
      stats: [
        {
          icon: <Hash className="h-5 w-5 text-TT-purple-accent" />,
          value: stats.tokens_decoded,
          label: "Tokens Decoded",
          unit: "",
        },
        {
          icon: <FileText className="h-5 w-5 text-TT-purple-accent" />,
          value: stats.tokens_prefilled,
          label: "Tokens Prefilled",
          unit: "",
        },
        {
          icon: <AlignJustify className="h-5 w-5 text-TT-purple-accent" />,
          value: stats.context_length,
          label: "Context Length",
          unit: "",
        },
      ],
    },
  ];

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(true)}
              className="text-gray-500 p-1 h-auto hover:bg-black/10"
            >
              <BarChart2 className="h-4 w-4" />
              <span className="sr-only">Show Speed Insights</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Show Speed Insights</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-[500px] p-4 sm:p-6 bg-black text-white border-zinc-800">
          <div className="absolute right-4 top-4">
            <DialogClose className="h-6 w-6 rounded-full p-0 hover:bg-white/10">
              <span className="sr-only">Close</span>
            </DialogClose>
          </div>

          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl font-medium text-white">
              <Zap className="h-8 w-8 sm:h-10 sm:w-10 text-TT-purple-accent" />
              Inference Speed Insights
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 sm:space-y-8 py-4 sm:py-6 border-t border-zinc-800">
            {sections.map((section, i) => (
              <div key={i} className="space-y-3 sm:space-y-4">
                <h3 className="text-base sm:text-lg font-medium text-white/90">
                  {section.title}
                </h3>
                <div className="grid grid-cols-3 gap-2 sm:gap-8">
                  {section.stats.map((stat, j) => (
                    <div key={j} className="text-center space-y-1">
                      <div className="flex justify-center mb-1 sm:mb-2 text-white/70">
                        {stat.icon}
                      </div>
                      <div className="text-lg sm:text-3xl font-light text-white">
                        {stat.value}
                        {stat.unit}
                      </div>
                      <div className="text-xs sm:text-sm text-white/60 truncate">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-800 pt-3 sm:pt-4 text-2xs sm:text-xs text-white/60 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-white/60" />
              <span className="whitespace-nowrap">
                Round trip time:{" "}
                {formatValue(
                  (stats.user_ttft_s || 0) +
                    (stats.user_tpot || 0) * (stats.tokens_decoded || 0),
                  2
                )}
                s
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Hash className="h-3 w-3 text-white/60" />
              <span className="whitespace-nowrap">
                Model:{" "}
                <span className="text-TT-purple-accent">Tenstorrent</span>
                /Meta-Llama 3.1 70B
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
