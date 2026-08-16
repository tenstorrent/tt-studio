// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import { fetchDeployedModelsInfo } from "../api/modelsDeployedApis";

const POLL_INTERVAL_MS = 60_000;

/**
 * Whether the Search Agent can be used with the given deployed model.
 *
 * The deployed model's `tool_calling_enabled` flag is the primary signal; agent
 * service readiness is checked as a supplementary one. Shared by the chat UI and
 * the voice agent so both surfaces gate the toggle on the same conditions.
 */
export function useAgentAvailability(modelID: string | null | undefined): {
  isAgentAvailable: boolean;
  /** False until the first probe returns — don't act on `isAgentAvailable` before then. */
  hasChecked: boolean;
} {
  const [isAgentAvailable, setIsAgentAvailable] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkToolCallingAvailability = async () => {
      let modelHasToolCalling = false;
      let agentHasWebSearch = false;

      // 1. Check the selected model's tool_calling_enabled flag
      if (modelID) {
        try {
          const deployedModels = await fetchDeployedModelsInfo();
          const match = deployedModels.find((m) => m.id === modelID);
          modelHasToolCalling = match?.tool_calling_enabled === true;
        } catch {
          // If deployed info fails, model flag stays false
        }
      }

      // 2. Check whether Tavily is configured (backend always includes this,
      //    even when the agent container is unreachable).
      let tavilyConfigured = false;
      try {
        const res = await fetch("/models-api/agent/status/", {
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        if (res.ok) {
          const agent = data?.agent;
          agentHasWebSearch =
            agent?.status === "ready" && agent?.capabilities?.web_search === true;
        }
        tavilyConfigured = data?.backend?.tavily_configured === true;
      } catch {
        // Backend not reachable
      }

      if (cancelled) return;

      setIsAgentAvailable(modelHasToolCalling && (agentHasWebSearch || tavilyConfigured));
      setHasChecked(true);

      if (modelHasToolCalling && !tavilyConfigured) {
        console.warn(
          "[TT Studio] Search Agent is disabled — TAVILY_API_KEY is not configured.\n" +
          "To enable the Search Agent, set a valid TAVILY_API_KEY in your .env file.\n" +
          "Get your API key from: https://app.tavily.com"
        );
      }
    };

    checkToolCallingAvailability();
    const interval = setInterval(checkToolCallingAvailability, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [modelID]);

  return { isAgentAvailable, hasChecked };
}
