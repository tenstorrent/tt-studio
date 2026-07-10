// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type React from "react";
import { Handle, Position } from "@xyflow/react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { NodeStatus } from "../../../types/workflow";
import { useWorkflowStore } from "../../../store/workflowStore";

interface BaseNodeProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  accent: string;
  hasInput?: boolean;
  hasOutput?: boolean;
  children?: React.ReactNode;
}

const BORDER_BY_STATUS: Record<NodeStatus, string> = {
  idle: "border-zinc-700/60",
  running: "border-violet-500 ring-2 ring-violet-500/20",
  completed: "border-emerald-500/80",
  error: "border-red-500/80",
};

function StatusIndicator({ status }: { status: NodeStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />;
    case "completed":
      return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
    case "error":
      return <AlertCircle className="w-3 h-3 text-red-400" />;
    default:
      return null;
  }
}

export default function BaseNode({
  id,
  label,
  icon,
  accent,
  hasInput = true,
  hasOutput = true,
  children,
}: BaseNodeProps) {
  const nodeStatus = useWorkflowStore((s) => s.nodeStatuses[id]) || "idle";
  const isSelected = useWorkflowStore((s) => s.selectedNodeId === id);

  return (
    <div
      className={`
        rounded-xl border bg-zinc-900/95 backdrop-blur-sm w-[220px]
        transition-all duration-200 relative
        ${BORDER_BY_STATUS[nodeStatus]}
        ${isSelected ? "ring-2 ring-violet-500/50 border-violet-500/60" : ""}
      `}
    >
      {hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-2.5 !h-2.5 !bg-zinc-500 !border-2 !border-zinc-400 hover:!bg-violet-400 hover:!border-violet-300 !transition-colors"
        />
      )}

      <div className="overflow-hidden rounded-xl">
        {/* Header with accent stripe */}
        <div
          className="flex items-center gap-2.5 px-3 py-2.5"
          style={{ borderBottom: `2px solid ${accent}` }}
        >
          <div
            className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
            style={{ backgroundColor: `${accent}15` }}
          >
            <span style={{ color: accent }}>{icon}</span>
          </div>
          <span className="text-sm font-semibold text-zinc-100 truncate flex-1">
            {label}
          </span>
          <StatusIndicator status={nodeStatus} />
        </div>

        {children && (
          <div className="px-3 py-2 text-left">{children}</div>
        )}
      </div>

      {hasOutput && (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-2.5 !h-2.5 !bg-zinc-500 !border-2 !border-zinc-400 hover:!bg-violet-400 hover:!border-violet-300 !transition-colors"
        />
      )}
    </div>
  );
}
