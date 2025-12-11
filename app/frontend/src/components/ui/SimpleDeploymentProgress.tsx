// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState, useEffect } from "react";
import { Progress } from "./progress";

interface SimpleDeploymentProgressProps {
  isDeploying: boolean;
  className?: string;
}

export const SimpleDeploymentProgress: React.FC<
  SimpleDeploymentProgressProps
> = ({ isDeploying, className = "" }) => {
  const [progress, setProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [currentStage, setCurrentStage] = useState("Initializing");

  useEffect(() => {
    if (!isDeploying) {
      setProgress(0);
      setElapsedTime(0);
      setCurrentStage("Initializing");
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setElapsedTime(elapsed);

      // Dynamic progress calculation based on typical deployment stages
      // Match actual log messages from run.py
      let calculatedProgress = 0;
      let stage = "Initializing";

      if (elapsed < 5) {
        // 0-5s: Loading environment (0-15%)
        calculatedProgress = (elapsed / 5) * 15;
        stage = "Loading environment";
      } else if (elapsed < 15) {
        // 5-15s: Checking model setup (15-40%)
        calculatedProgress = 15 + ((elapsed - 5) / 10) * 25;
        stage = "Checking model setup";
      } else if (elapsed < 30) {
        // 15-30s: Preparing Docker configuration (40-70%)
        calculatedProgress = 40 + ((elapsed - 15) / 15) * 30;
        stage = "Preparing Docker configuration";
      } else if (elapsed < 50) {
        // 30-50s: Starting Docker container (70-85%)
        calculatedProgress = 70 + ((elapsed - 30) / 20) * 15;
        stage = "Starting Docker container";
      } else if (elapsed < 60) {
        // 50-60s: Connecting to network (85-90%)
        calculatedProgress = 85 + ((elapsed - 50) / 10) * 5;
        stage = "Connecting to network";
      } else if (elapsed < 65) {
        // 60-65s: Renaming container (90-95%)
        calculatedProgress = 90 + ((elapsed - 60) / 5) * 5;
        stage = "Finalizing deployment";
      } else {
        // 65s+: Should be done, cap at 95%
        calculatedProgress = 95;
        stage = "Completing deployment";
      }

      // Cap at 95% until we get confirmation
      setProgress(Math.min(calculatedProgress, 95));
      setCurrentStage(stage);
    }, 100);

    return () => clearInterval(interval);
  }, [isDeploying]);

  if (!isDeploying && progress === 0) return null;

  return (
    <div
      className={`mt-3 p-4 border rounded-lg bg-card shadow-sm ${className}`}
    >
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
          <span className="text-sm font-medium text-foreground">
            {currentStage}
          </span>
        </div>
        <span className="text-sm text-muted-foreground font-mono tabular-nums">
          {Math.round(progress)}%
        </span>
      </div>

      <div className="mb-2">
        <Progress value={progress} className="h-2" />
      </div>

      <p className="text-xs text-muted-foreground tabular-nums">
        Elapsed: {Math.round(elapsedTime)}s
      </p>
    </div>
  );
};
