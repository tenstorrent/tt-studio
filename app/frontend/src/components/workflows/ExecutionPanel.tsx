// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { Play, Square, RotateCcw, AlertCircle, CheckCircle2 } from "lucide-react";
import { useWorkflowStore } from "../../store/workflowStore";

export default function ExecutionPanel() {
  const {
    currentWorkflow,
    isRunning,
    runProgress,
    runError,
    nodeStatuses,
    nodeOutputs,
    agentReasoningLog,
    nodes,
    runWorkflow,
    cancelRun,
    resetExecution,
  } = useWorkflowStore();

  const [inputText, setInputText] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const completedNodes = Object.values(nodeStatuses).filter(
    (s) => s === "completed"
  ).length;
  const totalNodes = nodes.length;
  const progressPercent = Math.round(runProgress * 100);
  const hasFinished = !isRunning && completedNodes > 0;

  const handleRun = () => {
    if (!inputText.trim()) return;
    runWorkflow(inputText);
  };

  const handleReset = () => {
    resetExecution();
    setInputText("");
    setShowDetails(false);
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-900">
      {/* Input + controls row */}
      <div className="flex items-center gap-2 px-4 py-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isRunning && handleRun()}
          disabled={isRunning}
          placeholder={
            currentWorkflow
              ? "Enter your input and press Run..."
              : "Save your workflow first, then run it"
          }
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 
                     placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500
                     disabled:opacity-50"
        />

        {isRunning ? (
          <button
            onClick={cancelRun}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 text-white 
                       text-xs font-medium rounded transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            Stop
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={!currentWorkflow || !inputText.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white 
                       text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play className="w-3.5 h-3.5" />
            Run
          </button>
        )}

        {hasFinished && (
          <button
            onClick={handleReset}
            title="Reset"
            className="p-2 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}

        {(isRunning || hasFinished) && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors underline"
          >
            {showDetails ? "Hide" : "Details"}
          </button>
        )}
      </div>

      {/* Progress bar */}
      {(isRunning || hasFinished) && (
        <div className="px-4 pb-1">
          <div className="flex items-center gap-2 mb-1">
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  runError ? "bg-red-500" : "bg-violet-500"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-500 tabular-nums w-16 text-right">
              {completedNodes}/{totalNodes} nodes
            </span>
          </div>

          {/* Status message */}
          {runError && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 mb-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{runError}</span>
            </div>
          )}
          {hasFinished && !runError && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Workflow completed successfully
            </div>
          )}
        </div>
      )}

      {/* Expandable details */}
      {showDetails && (
        <div className="border-t border-zinc-800 max-h-48 overflow-y-auto px-4 py-2">
          <div className="flex flex-col gap-2">
            {nodes.map((node) => {
              const status = nodeStatuses[node.id] || "idle";
              const output = nodeOutputs[node.id];
              const reasoning = agentReasoningLog[node.id];
              const label =
                (node.data as Record<string, unknown>).label as string ||
                node.type;

              return (
                <div
                  key={node.id}
                  className="flex flex-col gap-0.5 text-xs border-l-2 pl-2"
                  style={{
                    borderColor:
                      status === "completed"
                        ? "#10b981"
                        : status === "running"
                          ? "#8b5cf6"
                          : status === "error"
                            ? "#ef4444"
                            : "#3f3f46",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-300">{label}</span>
                    <span className="text-zinc-500">({node.type})</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        status === "completed"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : status === "running"
                            ? "bg-violet-500/10 text-violet-400"
                            : status === "error"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {status}
                    </span>
                  </div>
                  {output && (
                    <p className="text-zinc-400 truncate max-w-md">
                      {output.slice(0, 200)}
                    </p>
                  )}
                  {reasoning && reasoning.length > 0 && (
                    <p className="text-amber-300/70 truncate max-w-md">
                      {/Searching:/.test(reasoning.join(""))
                        ? "Searched the web"
                        : "Agent reasoning complete"}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
