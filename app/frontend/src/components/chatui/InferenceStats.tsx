// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { useState } from "react";
import {
  BarChart2,
  Clock,
  Zap,
  Hash,
  AlignJustify,
  FileText,
  Activity,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { useTheme } from "../../hooks/useTheme"; // Import the existing theme provider
import type { InferenceStatsProps } from "./types";

interface InferenceStatsComponentProps extends InferenceStatsProps {
  inline?: boolean;
}

export default function Component({
  stats,
  modelName,
  inline = false,
}: InferenceStatsComponentProps) {
  const [open, setOpen] = useState(false);
  const { theme } = useTheme(); // Use your existing theme hook

  // Determine dark mode based on the theme value
  const isDarkMode = theme === "dark";

  // Check if we're in deployed mode or AI playground mode
  const apiUrlDefined = import.meta.env.VITE_ENABLE_DEPLOYED === "true";

  if (!stats) return null;

  const formatValue = (value: number | undefined) => {
    if (typeof value !== "number")
      return { value: "N/A", unit: "", isSmall: false };

    // Convert to milliseconds if value is small (less than 0.1 seconds)
    if (value < 0.1) {
      return {
        value: (value * 1000).toFixed(2),
        unit: "ms",
        isSmall: true,
      };
    }

    return {
      value: value.toFixed(2),
      unit: "s",
      isSmall: false,
    };
  };

  const userTPS =
    typeof stats.user_tpot === "number"
      ? (1 / Math.max(stats.user_tpot, 0.000001)).toFixed(2)
      : "N/A";

  // Define the stat item type to include isSmall property
  type StatItem = {
    icon: React.ReactNode;
    value: string | number;
    unit: string;
    label: string;
    isSmall?: boolean;
  };

  const sections = [
    {
      title: "Time Metrics",
      stats: [
        {
          icon: (
            <Clock
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          ...formatValue(stats.user_ttft_s),
          label: "Time to First Token",
        } as StatItem,
        {
          icon: (
            <Zap
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          ...formatValue(stats.user_tpot),
          label: "Time Per Output Token",
        } as StatItem,
        {
          icon: (
            <Activity
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          value: userTPS,
          label: "User Tokens Per Second",
          unit: "",
          isSmall: false,
        } as StatItem,
      ],
    },
    {
      title: "Token Metrics",
      stats: [
        {
          icon: (
            <Hash
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          value: stats.tokens_decoded,
          label: "Tokens Decoded",
          unit: "",
          isSmall: false,
        } as StatItem,
        {
          icon: (
            <FileText
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          value: stats.tokens_prefilled,
          label: "Tokens Prefilled",
          unit: "",
          isSmall: false,
        } as StatItem,
        {
          icon: (
            <AlignJustify
              className={`h-5 w-5 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
            />
          ),
          value: stats.context_length,
          label: "Context Length",
          unit: "",
          isSmall: false,
        } as StatItem,
      ],
    },
  ];

  // Function to get the display model name
  const getDisplayModelName = () => {
    if (apiUrlDefined) {
      // In deployed mode, use the actual model name or fallback
      return modelName || "Unknown Model";
    } else {
      // In AI playground mode, always show the 3.3 model
      return "Tenstorrent/Meta-Llama 3.3 70B";
    }
  };

  // Reusable stats display component
  const StatsDisplay = ({ className = "" }: { className?: string }) => (
    <div className={`space-y-4 sm:space-y-6 ${className}`}>
      {sections.map((section, i) => (
        <div key={i} className="space-y-2 sm:space-y-3">
          <h3
            className={`text-sm sm:text-base font-medium ${isDarkMode ? "text-white/90" : "text-gray-800"}`}
          >
            {section.title}
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            {section.stats.map((stat, j) => (
              <div
                key={j}
                className={`text-center space-y-1 rounded-lg p-2 ${isDarkMode ? "bg-zinc-900/50" : "bg-gray-100"}`}
              >
                <div
                  className={`flex justify-center mb-1 ${isDarkMode ? "text-white/70" : "text-gray-600"}`}
                >
                  {stat.icon}
                </div>
                <div
                  className={`text-sm sm:text-lg font-light ${isDarkMode ? "text-white" : "text-gray-900"}`}
                >
                  {stat.value}
                  {stat.isSmall ? <span>{stat.unit}</span> : stat.unit}
                </div>
                <div
                  className={`text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"} overflow-hidden text-ellipsis px-1`}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div
        className={`border-t ${isDarkMode ? "border-zinc-800" : "border-gray-200"} pt-2 sm:pt-3 text-xs ${isDarkMode ? "text-white/60" : "text-gray-500"} flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2`}
      >
        <div className="flex items-center gap-1">
          <Clock
            className={`h-3 w-3 ${isDarkMode ? "text-white/60" : "text-gray-500"}`}
          />
          <span className="whitespace-normal break-words">
            Round trip time:{" "}
            {
              formatValue(
                (stats.user_ttft_s || 0) +
                  (stats.user_tpot || 0) * (stats.tokens_decoded || 0)
              ).value
            }
            {formatValue(
              (stats.user_ttft_s || 0) +
                (stats.user_tpot || 0) * (stats.tokens_decoded || 0)
            ).isSmall ? (
              <span className={isDarkMode ? "text-red-400" : "text-red-500"}>
                {
                  formatValue(
                    (stats.user_ttft_s || 0) +
                      (stats.user_tpot || 0) * (stats.tokens_decoded || 0)
                  ).unit
                }
              </span>
            ) : (
              formatValue(
                (stats.user_ttft_s || 0) +
                  (stats.user_tpot || 0) * (stats.tokens_decoded || 0)
              ).unit
            )}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Hash
            className={`h-3 w-3 ${isDarkMode ? "text-white/60" : "text-gray-500"}`}
          />
          <span className="whitespace-nowrap">
            Model:{" "}
            <span
              className={
                isDarkMode ? "text-TT-purple-accent" : "text-violet-600"
              }
            >
              {getDisplayModelName()}
            </span>
          </span>
        </div>
      </div>
    </div>
  );

  // Return inline display if requested
  if (inline) {
    const userTPS =
      typeof stats.user_tpot === "number"
        ? (1 / Math.max(stats.user_tpot, 0.000001)).toFixed(1)
        : "N/A";
    const ttft = formatValue(stats.user_ttft_s);
    const tokens = stats.tokens_decoded || 0;

    return (
      <>
        <div
          className={`flex items-center gap-2 px-2 py-1 rounded-md text-xs cursor-pointer transition-colors ${isDarkMode ? "bg-zinc-900/50 text-white/70 hover:bg-zinc-800/50" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          onClick={() => setOpen(true)}
        >
          <Zap
            className={`h-3 w-3 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
          />
          <span className="flex items-center gap-3">
            <span>
              TTFT: {ttft.value}
              {ttft.unit}
            </span>
            <span>•</span>
            <span>{userTPS} tok/s</span>
            <span>•</span>
            <span>{tokens} tokens</span>
          </span>
        </div>

        {/* Modal dialog for detailed view */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            className={`max-w-[95vw] sm:max-w-[500px] p-4 sm:p-6 ${isDarkMode ? "bg-black text-white border-zinc-800" : "bg-white text-gray-900 border-gray-200"} rounded-xl`}
          >
            <DialogHeader>
              <DialogTitle
                className={`flex items-center gap-2 text-lg sm:text-xl font-medium ${isDarkMode ? "text-white" : "text-gray-900"}`}
              >
                <Zap
                  className={`h-8 w-8 sm:h-10 sm:w-10 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
                />
                Inference Speed Insights
              </DialogTitle>
              <DialogDescription
                className={`text-sm ${isDarkMode ? "text-white/70" : "text-gray-500"}`}
              >
                Model Inference Performance Metrics
              </DialogDescription>
            </DialogHeader>

            <div
              className={`py-4 sm:py-6 border-t ${isDarkMode ? "border-zinc-800" : "border-gray-200"}`}
            >
              <StatsDisplay className="space-y-6 sm:space-y-8" />
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(true)}
              className="text-gray-500 p-1 h-auto hover:bg-black/10 rounded-full"
            >
              <BarChart2 className="h-4 w-4" />
              <span className="sr-only">Show Speed Insights</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Show Speed Insights</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={`max-w-[95vw] sm:max-w-[500px] p-4 sm:p-6 ${isDarkMode ? "bg-black text-white border-zinc-800" : "bg-white text-gray-900 border-gray-200"} rounded-xl`}
        >
          <DialogHeader>
            <DialogTitle
              className={`flex items-center gap-2 text-lg sm:text-xl font-medium ${isDarkMode ? "text-white" : "text-gray-900"}`}
            >
              <Zap
                className={`h-8 w-8 sm:h-10 sm:w-10 ${isDarkMode ? "text-TT-purple-accent" : "text-violet-600"}`}
              />
              Inference Speed Insights
            </DialogTitle>
            <DialogDescription
              className={`text-sm ${isDarkMode ? "text-white/70" : "text-gray-500"}`}
            >
              Model Inference Performance Metrics
            </DialogDescription>
          </DialogHeader>

          <div
            className={`py-4 sm:py-6 border-t ${isDarkMode ? "border-zinc-800" : "border-gray-200"}`}
          >
            <StatsDisplay className="space-y-6 sm:space-y-8" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
