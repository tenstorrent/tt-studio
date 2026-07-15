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

  const autoSelectedName = data._autoSelectedCollection as string | undefined;

  useEffect(() => {
    axios
      .get("/collections-api/")
      .then((res) => {
        const list = Array.isArray(res.data)
          ? res.data
          : (res.data as Record<string, unknown>).results ?? [];
        const fetched = list as Collection[];
        setCollections(fetched);

        // Auto-select the first collection when none is set
        if (
          fetched.length > 0 &&
          !data.collection_name &&
          !data._autoSelectAttempted
        ) {
          const defaultName = fetched[0].name;
          updateNodeData(nodeId, {
            collection_name: defaultName,
            _autoSelectedCollection: defaultName,
            _autoSelectAttempted: true,
          });
        }
      })
      .catch(() => setCollections([]));

  }, [data.collection_name, data._autoSelectAttempted, nodeId, updateNodeData]);

  /** Dismiss the auto-selection banner */
  const dismissBanner = () => {
    updateNodeData(nodeId, { _autoSelectedCollection: undefined });
  };

  /** Manual collection change — clears the auto-select flag */
  const handleCollectionChange = (value: string) => {
    updateNodeData(nodeId, {
      collection_name: value,
      _autoSelectedCollection: undefined,
      _autoSelectAttempted: true,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Banner: no collections exist — guide the user to RAG setup */}
      {collections.length === 0 && (
        <div className="flex items-start gap-2 p-3 bg-yellow-900/50 border border-yellow-700/60 rounded-lg text-sm text-yellow-200">
          <span className="mt-0.5">⚠️</span>
          <p>
            No RAG collections found.{" "}
            <a
              href="/rag"
              className="underline font-semibold hover:text-yellow-100"
            >
              Set up a collection
            </a>{" "}
            to enable retrieval.
          </p>
        </div>
      )}

      {/* Banner: auto-selected notification (dismissible) */}
      {autoSelectedName && collections.length > 0 && (
        <div className="flex items-start justify-between gap-2 p-3 bg-blue-900/50 border border-blue-700/60 rounded-lg text-sm text-blue-200">
          <p>
            Auto-selected collection{" "}
            <strong className="text-blue-100">
              &apos;{autoSelectedName}&apos;
            </strong>{" "}
            — change it in the node config.
          </p>
          <button
            onClick={dismissBanner}
            className="shrink-0 text-blue-400 hover:text-white transition-colors"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

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
          onChange={(e) => handleCollectionChange(e.target.value)}
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
