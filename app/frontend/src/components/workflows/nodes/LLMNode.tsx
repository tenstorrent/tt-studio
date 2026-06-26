// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo } from "react";
import { MessageSquare } from "lucide-react";
import type { NodeProps } from "@xyflow/react";
import BaseNode from "./BaseNode";
import { useWorkflowStore } from "../../../store/workflowStore";

function LLMNodeComponent({ id, data }: NodeProps) {
  const label = (data.label as string) || "LLM";
  const output = useWorkflowStore((s) => s.nodeOutputs[id]);
  const isRunning = useWorkflowStore((s) => s.nodeStatuses[id] === "running");

  return (
    <BaseNode
      id={id}
      label={label}
      icon={<MessageSquare className="w-4 h-4" />}
      accent="#a78bfa"
    >
      <div className="flex items-center gap-3 text-[11px] text-zinc-500">
        <span>Temp {(data.temperature as number) ?? 0.7}</span>
        <span className="text-zinc-700">|</span>
        <span>Max {(data.max_tokens as number) ?? 1024}</span>
      </div>
      {isRunning && output && (
        <p className="text-[11px] text-zinc-400 mt-1.5 max-h-14 overflow-hidden whitespace-pre-wrap break-words leading-tight opacity-70">
          {output.slice(-100)}
        </p>
      )}
    </BaseNode>
  );
}

export default memo(LLMNodeComponent);
