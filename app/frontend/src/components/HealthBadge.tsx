// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

export interface StartupPhase {
  phase: string;
  phase_label: string;
  progress: number;
  message: string;
  last_heartbeat_seconds: number | null;
  warmup_seq_len: number | null;
  trace_count: number;
  classified_at: number;
  // Populated by Django `_get_startup_phase` when phase === "downloading_weights"
  // (see app/backend/model_control/download_progress.py).
  weights_repo?: string | null;
  weights_cached?: boolean;
  downloaded_bytes?: number | null;
  total_bytes?: number | null;
  speed_bps?: number | null;
  eta_seconds?: number | null;
  // Category-aware phase template. LLM and media-server models walk through
  // different sequences (LLM has compile + KV alloc, media has worker pool +
  // warmup), so the backend tells the frontend which phases to render in the
  // PhaseTrack instead of the frontend hardcoding the LLM list.
  category?: "llm" | "media";
  phases?: string[];
  phase_labels?: Record<string, string>;
  phase_base_pct?: Record<string, number>;
}

interface HealthBadgeProps {
  deployId: string;
  onHealthChange?: (status: HealthStatus, phase?: StartupPhase | null) => void;
}

export interface HealthBadgeRef {
  refreshHealth: () => Promise<void>;
}

type HealthStatus = "healthy" | "starting" | "unavailable" | "unhealthy" | "unknown";

const HealthBadge = forwardRef<HealthBadgeRef, HealthBadgeProps>(
  ({ deployId, onHealthChange }, ref) => {
    const [health, setHealth] = useState<HealthStatus>("unknown");
    const [phase, setPhase] = useState<StartupPhase | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isMonitoring, setIsMonitoring] = useState(false);

    const fetchHealth = useCallback(async () => {
      try {
        const response = await fetch(
          `/models-api/health/?deploy_id=${deployId}`,
          {
            method: "GET",
          }
        );

        if (response.status === 200) {
          setHealth("healthy");
          setPhase(null);
        } else if (response.status === 202) {
          setHealth("starting");
          try {
            const body = await response.json();
            setPhase((body?.phase as StartupPhase) ?? null);
          } catch {
            setPhase(null);
          }
        } else if (response.status === 503) {
          setHealth("unavailable");
          setPhase(null);
        } else {
          setHealth("unknown");
          setPhase(null);
        }
      } catch (e) {
        setHealth("unknown");
        setPhase(null);
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
        console.log(
          `[HealthBadge ${deployId}] Setting up health check interval`
        );
        healthRefreshInterval = setInterval(() => {
          console.log(`[HealthBadge ${deployId}] Checking health (interval)`);
          fetchHealth();
        }, 3000) as unknown as number;
      }

      return () => {
        if (healthRefreshInterval) {
          console.log(
            `[HealthBadge ${deployId}] Cleaning up health check interval`
          );
          clearInterval(healthRefreshInterval);
        }
      };
    }, [isMonitoring, fetchHealth, deployId]);

    useEffect(() => {
      onHealthChange?.(health, phase);
    }, [health, phase, onHealthChange]);

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
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap leading-none ${getStatusColor()} transition-colors duration-200`}
              style={{ minHeight: 28 }}
            >
              <div
                className={`w-2 h-2 rounded-full mr-2 ${getDotColor()} ${health === "healthy" || health === "starting" ? "animate-pulse" : ""}`}
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
