// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { memo } from "react";
import { Bot, Globe, Loader2 } from "lucide-react";
import type { NodeProps } from "@xyflow/react";
import BaseNode from "./BaseNode";
import { useWorkflowStore } from "../../../store/workflowStore";

function AgentNodeComponent({ id, data }: NodeProps) {
  const label = (data.label as string) || "Agent";
  const goal = (data.goal as string) || "";
  const reasoning = useWorkflowStore((s) => s.agentReasoningLog[id]);
  const isRunning = useWorkflowStore((s) => s.nodeStatuses[id] === "running");

  const fullText = reasoning ? reasoning.join("") : "";
  const isSearching = /\[searching\]|Searching:/.test(fullText);
  const lastLine = fullText.split("\n").filter(Boolean).pop() || "";

  return (
    <BaseNode
      id={id}
      label={label}
      icon={<Bot className="w-4 h-4" />}
      accent="#fbbf24"
    >
      {goal && (
        <p className="text-[11px] text-zinc-500 truncate">
          <span className="text-zinc-600">Goal:</span> {goal.slice(0, 50)}
          {goal.length > 50 && "..."}
        </p>
      )}
      {!goal && (
        <p className="text-[11px] text-zinc-600 italic">No goal set</p>
      )}
      {isRunning && fullText && (
        <div className="flex items-center gap-1.5 mt-1">
          {isSearching ? (
            <Globe className="w-3 h-3 text-blue-400 animate-spin flex-shrink-0" />
          ) : (
            <Loader2 className="w-3 h-3 text-amber-400 animate-spin flex-shrink-0" />
          )}
          <p className="text-[11px] text-amber-300/60 truncate leading-tight">
            {isSearching ? "Searching..." : lastLine.slice(0, 80)}
          </p>
        </div>
      )}
    </BaseNode>
  );
}

export default memo(AgentNodeComponent);
