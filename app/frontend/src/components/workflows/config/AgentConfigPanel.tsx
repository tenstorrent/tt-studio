// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useWorkflowStore } from "../../../store/workflowStore";

interface Props {
  nodeId: string;
  data: Record<string, unknown>;
}

export default function AgentConfigPanel({ nodeId, data }: Props) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  return (
    <div className="flex flex-col gap-4">
      <Field label="Label">
        <input
          type="text"
          value={(data.label as string) || ""}
          onChange={(e) => updateNodeData(nodeId, { label: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </Field>

      <Field label="Agent Goal">
        <textarea
          value={(data.goal as string) || ""}
          onChange={(e) => updateNodeData(nodeId, { goal: e.target.value })}
          rows={4}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-y"
          placeholder="e.g. Research this topic and extract key findings"
        />
        <p className="text-xs text-zinc-500 mt-1">
          The agent will autonomously decide which tools to call to achieve this
          goal.
        </p>
      </Field>

      <div className="border-t border-zinc-800 pt-3">
        <p className="text-xs text-zinc-400 font-medium mb-2">
          Available Tools
        </p>
        <div className="flex flex-col gap-2">
          <ToolToggle label="Web Search (Tavily)" checked disabled />
          <ToolToggle label="RAG Query" checked disabled />
          <ToolToggle label="Code Interpreter" checked={false} disabled />
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          Tools are managed by the agent service configuration.
        </p>
      </div>
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

function ToolToggle({
  label,
  checked,
  disabled,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-300">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        readOnly
        className="accent-amber-500"
      />
      {label}
    </label>
  );
}
