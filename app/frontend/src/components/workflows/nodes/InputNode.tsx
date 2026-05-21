// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { memo } from "react";
import { ArrowRightToLine } from "lucide-react";
import type { NodeProps } from "@xyflow/react";
import BaseNode from "./BaseNode";

function InputNodeComponent({ id, data }: NodeProps) {
  const label = (data.label as string) || "User Input";

  return (
    <BaseNode
      id={id}
      label={label}
      icon={<ArrowRightToLine className="w-4 h-4" />}
      accent="#34d399"
      hasInput={false}
      hasOutput={true}
    >
      <p className="text-[11px] text-zinc-500">Workflow entry point</p>
    </BaseNode>
  );
}

export default memo(InputNodeComponent);
