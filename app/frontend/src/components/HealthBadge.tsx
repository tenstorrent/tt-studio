// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

interface HealthBadgeProps {
  deployId: string;
  onHealthChange?: (status: HealthStatus) => void;
}

export interface HealthBadgeRef {
  refreshHealth: () => Promise<void>;
}

type HealthStatus = "healthy" | "unavailable" | "unhealthy" | "unknown";

const HealthBadge = forwardRef<HealthBadgeRef, HealthBadgeProps>(
  ({ deployId, onHealthChange }, ref) => {
    const [health, setHealth] = useState<HealthStatus>("unknown");
    const [isLoading, setIsLoading] = useState(true);
    const [isMonitoring, setIsMonitoring] = useState(false);

    const fetchHealth = useCallback(async () => {
      try {
        const response = await fetch(`/models-api/health/?deploy_id=${deployId}`, {
          method: "GET",
        });

        if (response.status === 200) {
          setHealth("healthy");
        } else if (response.status === 503) {
          setHealth("unavailable");
        } else {
          setHealth("unknown");
        }
      } catch (e) {
        setHealth("unknown");
      } finally {
        setIsLoading(false);
      }
    }, [deployId]);

    // Expose refresh method via ref
    useImperativeHandle(
      ref,
      () => ({
        refreshHealth: fetchHealth,
      }),
      [fetchHealth]
    );

    // Initial health check
    useEffect(() => {
      fetchHealth();
    }, [fetchHealth]);

    // Start monitoring for non-healthy models
    useEffect(() => {
      console.log(
        `[HealthBadge ${deployId}] Health changed to: ${health}, isMonitoring: ${isMonitoring}`
      );
      if (health !== "healthy" && !isMonitoring) {
        console.log(
          `[HealthBadge ${deployId}] Starting health monitoring for model: ${deployId} (${health})`
        );
        setIsMonitoring(true);
      }
    }, [health, deployId, isMonitoring]);

    // Stop monitoring when model becomes healthy
    useEffect(() => {
      if (health === ("healthy" as HealthStatus) && isMonitoring) {
        console.log(
          `[HealthBadge ${deployId}] Model became healthy, stopping monitoring: ${deployId}`
        );
        setIsMonitoring(false);
      }
    }, [health, deployId, isMonitoring]);

    // Health monitoring interval
    useEffect(() => {
      let healthRefreshInterval: number | null = null;

      console.log(
        `[HealthBadge ${deployId}] Interval effect running. isMonitoring: ${isMonitoring}`
      );
      if (isMonitoring) {
        console.log(`[HealthBadge ${deployId}] Setting up health check interval`);
        healthRefreshInterval = setInterval(() => {
          console.log(`[HealthBadge ${deployId}] Checking health (interval)`);
          fetchHealth();
        }, 3000) as unknown as number;
      }

      return () => {
        if (healthRefreshInterval) {
          console.log(`[HealthBadge ${deployId}] Cleaning up health check interval`);
          clearInterval(healthRefreshInterval);
        }
      };
    }, [isMonitoring, fetchHealth, deployId]);

    useEffect(() => {
      onHealthChange?.(health);
    }, [health, onHealthChange]);

    const getStatusColor = () => {
      switch (health) {
        case "healthy":
          return "bg-[#4CAF50] text-white";
        case "unhealthy":
          return "bg-red-500 text-white";
        default:
          return "bg-yellow-500 text-white";
      }
    };

    const getDotColor = () => {
      switch (health) {
        case "healthy":
          return "bg-[#A5D6A7]";
        case "unhealthy":
          return "bg-red-300";
        default:
          return "bg-yellow-300";
      }
    };

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap ${getStatusColor()} transition-colors duration-200`}
            >
              <div
                className={`w-2 h-2 rounded-full ${getDotColor()} ${health === "healthy" ? "animate-pulse" : ""}`}
              />
              {isLoading ? "Loading..." : health}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              Docker Container Health: {health}{" "}
              {isMonitoring ? "(checking every 3s)" : "(monitoring stopped)"}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
);

HealthBadge.displayName = "HealthBadge";

export default HealthBadge;
