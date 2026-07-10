// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useWorkflowStore } from "../../../store/workflowStore";

interface Props {
  nodeId: string;
  data: Record<string, unknown>;
}

export default function InputConfigPanel({ nodeId, data }: Props) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  return (
    <div className="flex flex-col gap-4">
      <Field label="Label">
        <input
          type="text"
          value={(data.label as string) || ""}
          onChange={(e) => updateNodeData(nodeId, { label: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 
                     focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </Field>
      <Field label="Default Text">
        <textarea
          value={(data.text as string) || ""}
          onChange={(e) => updateNodeData(nodeId, { text: e.target.value })}
          rows={4}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 
                     focus:outline-none focus:ring-1 focus:ring-violet-500 resize-y"
          placeholder="Optional default input text..."
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
