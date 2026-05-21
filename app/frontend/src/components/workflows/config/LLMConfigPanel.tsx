// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import axios from "axios";
import { useWorkflowStore } from "../../../store/workflowStore";

interface DeployedModel {
  id: string;
  name: string;
  status: string;
}

interface Props {
  nodeId: string;
  data: Record<string, unknown>;
}

export default function LLMConfigPanel({ nodeId, data }: Props) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const [models, setModels] = useState<DeployedModel[]>([]);

  useEffect(() => {
    axios
      .get("/models-api/deployed")
      .then((res) => {
        const entries = Object.entries(
          (res.data as Record<string, Record<string, unknown>>) || {}
        ).map(([id, info]) => ({
          id,
          name: (info.cached_model_name as string) || (info.model_name as string) || id.slice(0, 12),
          status: (info.status as string) || "unknown",
        }));
        setModels(entries.filter((m) => m.status === "running"));
      })
      .catch(() => setModels([]));
  }, []);

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

      <Field label="Deployed Model">
        <select
          value={(data.deploy_id as string) || ""}
          onChange={(e) => updateNodeData(nodeId, { deploy_id: e.target.value })}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="">Auto-select first available</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Prompt Template">
        <textarea
          value={(data.prompt_template as string) || "{input}"}
          onChange={(e) =>
            updateNodeData(nodeId, { prompt_template: e.target.value })
          }
          rows={5}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-y font-mono text-xs"
          placeholder="Use {input} for upstream text"
        />
        <p className="text-xs text-zinc-500 mt-1">
          Use <code className="text-violet-400">{"{input}"}</code> to inject
          upstream output.
        </p>
      </Field>

      <Field label={`Temperature: ${data.temperature ?? 0.7}`}>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={(data.temperature as number) ?? 0.7}
          onChange={(e) =>
            updateNodeData(nodeId, { temperature: parseFloat(e.target.value) })
          }
          className="w-full accent-violet-500"
        />
      </Field>

      <Field label={`Max Tokens: ${data.max_tokens ?? 1024}`}>
        <input
          type="range"
          min={64}
          max={4096}
          step={64}
          value={(data.max_tokens as number) ?? 1024}
          onChange={(e) =>
            updateNodeData(nodeId, { max_tokens: parseInt(e.target.value) })
          }
          className="w-full accent-violet-500"
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
