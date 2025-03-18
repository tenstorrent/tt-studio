// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
// This file incorporates work covered by the following copyright and permission notice:
//  SPDX-FileCopyrightText: Copyright (c) https://21st.dev/
//  SPDX-License-Identifier: MIT

import React from "react";
import {
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "framer-motion";
import { cn } from "../../lib/utils";

interface ScrollProgressBarType {
  type?: "circle" | "bar";
  position?: "top-right" | "bottom-right" | "top-left" | "bottom-left";
  color?: string;
  strokeSize?: number;
  showPercentage?: boolean;
}

export default function ScrollProgressBar({
  type = "circle",
  position = "bottom-right",
  color = "#8b5cf6", // Default to purple
  strokeSize = 2,
  showPercentage = false,
}: ScrollProgressBarType) {
  const { scrollYProgress } = useScroll();
  const scrollPercentage = useTransform(scrollYProgress, [0, 1], [0, 100]);
  const [percentage, setPercentage] = React.useState(0);

  useMotionValueEvent(scrollPercentage, "change", (latest) => {
    setPercentage(Math.round(latest));
  });

  if (type === "bar") {
    return (
      <div
        className="fixed start-0 end-0 top-0 z-50 pointer-events-none"
        style={{ height: `${strokeSize}px` }}
      >
        <motion.div
          className="h-full bg-opacity-80"
          style={{
            backgroundColor: color,
            scaleX: scrollYProgress,
            transformOrigin: "left",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn("fixed z-50 p-4 pointer-events-none", {
        "top-4 right-4": position === "top-right",
        "bottom-4 right-4": position === "bottom-right",
        "top-4 left-4": position === "top-left",
        "bottom-4 left-4": position === "bottom-left",
      })}
    >
      <div className="relative h-16 w-16 flex items-center justify-center">
        <svg className="w-full h-full" viewBox="0 0 100 100">
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke="rgba(0,0,0,0.1)"
            strokeWidth={strokeSize}
            className="dark:stroke-white/10"
          />
          {/* Progress circle */}
          <motion.circle
            cx="50"
            cy="50"
            r="40"
            pathLength="1"
            stroke={color}
            fill="none"
            strokeDasharray="1"
            strokeDashoffset="0"
            strokeWidth={strokeSize}
            style={{ pathLength: scrollYProgress }}
            className="stroke-current"
          />
        </svg>

        {showPercentage && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-medium" style={{ color }}>
              {percentage}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
