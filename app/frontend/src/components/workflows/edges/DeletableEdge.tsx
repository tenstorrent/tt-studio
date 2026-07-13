// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { useWorkflowStore } from "../../../store/workflowStore";

export default function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    useWorkflowStore.getState().setSelectedEdge(id);
    setTimeout(() => useWorkflowStore.getState().deleteSelected(), 0);
  };

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Invisible wider path for easier hover targeting */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
      />

      {/* Visible edge */}
      <BaseEdge path={edgePath} style={style} markerEnd={markerEnd} />

      {/* Delete button at midpoint – only rendered while hovered */}
      {hovered && (
        <EdgeLabelRenderer>
          <button
            onClick={handleDelete}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="flex items-center justify-center w-4 h-4 rounded-full
                       bg-red-500/90 hover:bg-red-500 text-white text-xs font-bold
                       border border-red-400/50 shadow-lg shadow-red-500/20
                       cursor-pointer backdrop-blur-sm"
            title="Delete connection"
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
