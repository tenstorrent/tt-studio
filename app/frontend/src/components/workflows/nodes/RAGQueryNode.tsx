// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo, useEffect } from "react";
import { Database } from "lucide-react";
import type { NodeProps } from "@xyflow/react";
import axios from "axios";
import BaseNode from "./BaseNode";
import { useWorkflowStore } from "../../../store/workflowStore";

function RAGQueryNodeComponent({ id, data }: NodeProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const label = (data.label as string) || "RAG Query";
  const collection = (data.collection_name as string) || "not set";

  // Auto-select the first collection if not set.
  // By checking data._autoSelectAttempted, we ensure that if a new template is loaded
  // (which resets the data object), this effect will run again even if the React component instance is reused by React Flow.
  useEffect(() => {
    if (data.collection_name || data._autoSelectAttempted) return;

    axios
      .get("/collections-api/")
      .then((res) => {
        const list: unknown[] = Array.isArray(res.data)
          ? res.data
          : ((res.data as Record<string, unknown>).results as unknown[]) ?? [];

        if (list.length > 0) {
          const first = (list as { name: string }[])[0].name;
          updateNodeData(id, {
            collection_name: first,
            _autoSelectedCollection: first,
            _autoSelectAttempted: true,
          });
        } else {
          updateNodeData(id, { _autoSelectAttempted: true });
        }
      })
      .catch(() => {
        updateNodeData(id, { _autoSelectAttempted: true });
      });
  }, [data.collection_name, data._autoSelectAttempted, id, updateNodeData]);

  return (
    <BaseNode
      id={id}
      label={label}
      icon={<Database className="w-4 h-4" />}
      accent="#60a5fa"
    >
      <p className="text-[11px] text-zinc-500 truncate">
        <span className="text-zinc-600">Collection:</span> {collection}
      </p>
      <p className="text-[11px] text-zinc-500">
        <span className="text-zinc-600">Top-k:</span> {(data.n_results as number) ?? 5}
      </p>
    </BaseNode>
  );
}

export default memo(RAGQueryNodeComponent);
