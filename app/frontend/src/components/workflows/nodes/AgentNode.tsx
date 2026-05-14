// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { memo } from "react";
import { Bot } from "lucide-react";
import type { NodeProps } from "@xyflow/react";
import BaseNode from "./BaseNode";
import { useWorkflowStore } from "../../../store/workflowStore";

function AgentNodeComponent({ id, data }: NodeProps) {
  const label = (data.label as string) || "Agent";
  const goal = (data.goal as string) || "";
  const reasoning = useWorkflowStore((s) => s.agentReasoningLog[id]);
  const isRunning = useWorkflowStore((s) => s.nodeStatuses[id] === "running");

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
      {isRunning && reasoning && reasoning.length > 0 && (
        <p className="text-[11px] text-amber-300/60 mt-1 max-h-12 overflow-hidden whitespace-pre-wrap break-words leading-tight font-mono">
          {reasoning[reasoning.length - 1]?.slice(0, 120)}
        </p>
      )}
    </BaseNode>
  );
}

export default memo(AgentNodeComponent);
