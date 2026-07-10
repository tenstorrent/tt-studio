// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo } from "react";
import { Database } from "lucide-react";
import type { NodeProps } from "@xyflow/react";
import BaseNode from "./BaseNode";

function RAGQueryNodeComponent({ id, data }: NodeProps) {
  const label = (data.label as string) || "RAG Query";
  const collection = (data.collection_name as string) || "not set";

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
