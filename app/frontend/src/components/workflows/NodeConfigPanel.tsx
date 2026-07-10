// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useRef, useEffect } from "react";
import {
  X,
  Trash2,
  Settings,
  Terminal,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Globe,
  Search,
  ChevronDown,
} from "lucide-react";
import { useWorkflowStore } from "../../store/workflowStore";
import InputConfigPanel from "./config/InputConfigPanel";
import LLMConfigPanel from "./config/LLMConfigPanel";
import RAGConfigPanel from "./config/RAGConfigPanel";
import AgentConfigPanel from "./config/AgentConfigPanel";

interface SourceLink {
  title: string;
  url: string;
}

interface SearchInfo {
  isSearch: boolean;
  queries: string[];
  sources: SourceLink[];
}

function parseSearchInfo(text: string): SearchInfo {
  const queries: string[] = [];
  const sources: SourceLink[] = [];
  const seenUrls = new Set<string>();

  const searchRegex = /Searching:\s*(.+)/g;
  let m;
  while ((m = searchRegex.exec(text)) !== null) {
    const q = m[1].trim();
    if (q) queries.push(q);
  }

  const sourceRegex = /Source:\s*\[([^\]]*)\]\(([^)]+)\)/g;
  while ((m = sourceRegex.exec(text)) !== null) {
    const title = m[1].trim();
    const url = m[2].trim();
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({ title: title || url, url });
    }
  }

  const hasSearchSignal = /\[searching\]/.test(text);

  return {
    isSearch: queries.length > 0 || sources.length > 0 || hasSearchSignal,
    queries,
    sources,
  };
}

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

        {/* Agent reasoning / search activity */}
        {reasoning && reasoning.length > 0 && (
          <AgentReasoningDisplay
            reasoning={reasoning}
            isRunning={status === "running"}
          />
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

function AgentReasoningDisplay({
  reasoning,
  isRunning,
}: {
  reasoning: string[];
  isRunning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fullText = reasoning.join("");
  const searchInfo = parseSearchInfo(fullText);

  useEffect(() => {
    if (scrollRef.current && isRunning) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [fullText, isRunning]);

  if (searchInfo.isSearch) {
    return (
      <div className="flex flex-col gap-2">
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {isRunning ? (
            <Globe className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          ) : (
            <Globe className="w-3.5 h-3.5 text-blue-400/70" />
          )}
          <span className="font-medium">
            {isRunning ? "Searching the web..." : "Searched the web"}
          </span>
          {searchInfo.queries.length > 0 && (
            <span className="text-zinc-600">
              ({searchInfo.queries.length}{" "}
              {searchInfo.queries.length === 1 ? "query" : "queries"})
            </span>
          )}
          <ChevronDown
            className={`w-3 h-3 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>

        {/* Search queries list */}
        {(expanded || isRunning) && searchInfo.queries.length > 0 && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden">
            <div className="px-3 py-2 space-y-1.5">
              {searchInfo.queries.map((q, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-zinc-300"
                >
                  <Search className="w-3 h-3 flex-shrink-0 text-zinc-500" />
                  <span>{q}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sources */}
        {searchInfo.sources.length > 0 && (expanded || isRunning) && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
            <p className="text-[10px] text-zinc-600 font-medium mb-1">
              Sources
            </p>
            {searchInfo.sources.map((src, i) => (
              <a
                key={i}
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-blue-400 hover:text-blue-300 truncate py-0.5"
              >
                {src.title}
              </a>
            ))}
          </div>
        )}

        {/* Full reasoning text (collapsed) */}
        {expanded && (
          <div
            ref={scrollRef}
            className="max-h-36 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed"
          >
            {fullText}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        {isRunning ? (
          <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-amber-400/70" />
        )}
        <span className="font-medium">
          {isRunning ? "Reasoning..." : "Reasoning complete"}
        </span>
        <ChevronDown
          className={`w-3 h-3 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {(expanded || isRunning) && (
        <div
          ref={scrollRef}
          className="max-h-48 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed"
        >
          {fullText}
        </div>
      )}
    </div>
  );
}
