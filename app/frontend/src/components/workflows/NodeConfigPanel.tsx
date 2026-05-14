// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from "react";
import {
  X,
  Trash2,
  Settings,
  Terminal,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Brain,
} from "lucide-react";
import { useWorkflowStore } from "../../store/workflowStore";
import InputConfigPanel from "./config/InputConfigPanel";
import LLMConfigPanel from "./config/LLMConfigPanel";
import RAGConfigPanel from "./config/RAGConfigPanel";
import AgentConfigPanel from "./config/AgentConfigPanel";

type Tab = "config" | "output";

export default function NodeConfigPanel() {
  const {
    nodes,
    selectedNodeId,
    setSelectedNode,
    deleteSelected,
    nodeStatuses,
    nodeOutputs,
    agentReasoningLog,
  } = useWorkflowStore();

  const [activeTab, setActiveTab] = useState<Tab>("config");

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const status = nodeStatuses[node.id] || "idle";
  const output = nodeOutputs[node.id];
  const reasoning = agentReasoningLog[node.id];
  const hasOutput = !!output || (reasoning && reasoning.length > 0);

  const renderConfig = () => {
    switch (node.type) {
      case "input":
        return <InputConfigPanel nodeId={node.id} data={node.data} />;
      case "llm":
        return <LLMConfigPanel nodeId={node.id} data={node.data} />;
      case "rag_query":
        return <RAGConfigPanel nodeId={node.id} data={node.data} />;
      case "agent":
        return <AgentConfigPanel nodeId={node.id} data={node.data} />;
      case "output":
        return (
          <p className="text-xs text-zinc-500">
            The output node displays the final result of the workflow. No
            configuration needed.
          </p>
        );
      default:
        return (
          <p className="text-xs text-zinc-500">
            No configuration available for this node type.
          </p>
        );
    }
  };

  const renderOutput = () => {
    if (status === "idle" && !hasOutput) {
      return (
        <p className="text-xs text-zinc-500 italic">
          Run the workflow to see output from this node.
        </p>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          {status === "running" && (
            <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin" />
          )}
          {status === "completed" && (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          )}
          {status === "error" && (
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
          )}
          <span
            className={`text-xs font-medium ${
              status === "running"
                ? "text-violet-400"
                : status === "completed"
                  ? "text-emerald-400"
                  : status === "error"
                    ? "text-red-400"
                    : "text-zinc-500"
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>

        {/* Agent reasoning steps */}
        {reasoning && reasoning.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
              <Brain className="w-3.5 h-3.5" />
              Reasoning ({reasoning.length} steps)
            </div>
            <div className="max-h-48 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-2">
              {reasoning.map((step, i) => (
                <div key={i} className="text-xs text-amber-300/70 font-mono py-0.5 border-b border-zinc-800/50 last:border-0">
                  <span className="text-zinc-600 mr-1.5">{i + 1}.</span>
                  {step}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Node output */}
        {output && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-zinc-400">Output</span>
            <div className="overflow-y-auto rounded border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-sm text-zinc-300 whitespace-pre-wrap break-words leading-relaxed text-left">
                {output}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full bg-zinc-900 border-l border-zinc-800 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            {(node.data as Record<string, unknown>).label as string ||
              node.type}
          </h3>
          <p className="text-xs text-zinc-500">{node.type}</p>
        </div>
        <button
          onClick={() => setSelectedNode(null)}
          className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setActiveTab("config")}
          className={`flex items-center gap-1.5 flex-1 px-4 py-2 text-xs font-medium transition-colors ${
            activeTab === "config"
              ? "text-violet-400 border-b-2 border-violet-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          Config
        </button>
        <button
          onClick={() => setActiveTab("output")}
          className={`flex items-center gap-1.5 flex-1 px-4 py-2 text-xs font-medium transition-colors relative ${
            activeTab === "output"
              ? "text-violet-400 border-b-2 border-violet-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          Output
          {hasOutput && activeTab !== "output" && (
            <span className="absolute top-1.5 right-3 w-1.5 h-1.5 rounded-full bg-emerald-400" />
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "config" ? renderConfig() : renderOutput()}
      </div>

      {/* Delete button */}
      <div className="px-4 py-3 border-t border-zinc-800">
        <button
          onClick={deleteSelected}
          className="flex items-center gap-1.5 w-full justify-center px-3 py-2 text-xs text-red-400 
                     hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/40 rounded transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Node
        </button>
      </div>
    </div>
  );
}
