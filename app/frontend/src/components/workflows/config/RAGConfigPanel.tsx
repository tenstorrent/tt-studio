// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import axios from "axios";
import { useWorkflowStore } from "../../../store/workflowStore";

interface Collection {
  name: string;
  id: string;
}

interface Props {
  nodeId: string;
  data: Record<string, unknown>;
}

export default function RAGConfigPanel({ nodeId, data }: Props) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    axios
      .get("/collections-api/")
      .then((res) => {
        const list = Array.isArray(res.data)
          ? res.data
          : (res.data as Record<string, unknown>).results ?? [];
        setCollections(list as Collection[]);
      })
      .catch(() => setCollections([]));
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

      <Field label="Collection">
        <select
          value={(data.collection_name as string) || ""}
          onChange={(e) =>
            updateNodeData(nodeId, { collection_name: e.target.value })
          }
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
        >
          <option value="">Select a collection...</option>
          {collections.map((c) => (
            <option key={c.id || c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={`Results to Retrieve: ${data.n_results ?? 5}`}>
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={(data.n_results as number) ?? 5}
          onChange={(e) =>
            updateNodeData(nodeId, { n_results: parseInt(e.target.value) })
          }
          className="w-full accent-blue-500"
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
