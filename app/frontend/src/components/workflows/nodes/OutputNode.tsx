// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo } from "react";
import { ArrowLeftFromLine } from "lucide-react";
import type { NodeProps } from "@xyflow/react";
import BaseNode from "./BaseNode";
import { useWorkflowStore } from "../../../store/workflowStore";

function OutputNodeComponent({ id, data }: NodeProps) {
  const label = (data.label as string) || "Output";
  const output = useWorkflowStore((s) => s.nodeOutputs[id]);

  return (
    <BaseNode
      id={id}
      label={label}
      icon={<ArrowLeftFromLine className="w-4 h-4" />}
      accent="#fb7185"
      hasInput={true}
      hasOutput={false}
    >
      {output ? (
        <p className="text-[11px] text-zinc-300 line-clamp-3 whitespace-pre-wrap break-words leading-relaxed">
          {output.slice(0, 150)}
        </p>
      ) : (
        <p className="text-[11px] text-zinc-600 italic">Result will appear here</p>
      )}
    </BaseNode>
  );
}

export default memo(OutputNodeComponent);
