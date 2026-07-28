// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useMemo, type DragEventHandler } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas-overrides.css";

import { useWorkflowStore } from "../../store/workflowStore";
import { nodeTypes } from "./nodes/nodeTypes";
import DeletableEdge from "./edges/DeletableEdge";
import type { WorkflowNodeType, WorkflowNode } from "../../types/workflow";
import type { NodeStatus } from "../../types/workflow";

/* ── Edge colours by execution state ───────────────────────────────── */

const EDGE_COLOR_DEFAULT = "#7c3aed";
const EDGE_COLOR_COMPLETED = "#10b981";
const EDGE_COLOR_ACTIVE = "#8b5cf6";
const EDGE_COLOR_ERROR = "#ef4444";
const EDGE_COLOR_IDLE = "#52525b";

function getEdgeStyle(
  sourceStatus: NodeStatus,
  targetStatus: NodeStatus,
  isNew: boolean
): { stroke: string; animated: boolean } {
  // If this edge was added after the execution, it hasn't carried data yet,
  // so it should always appear as Pending (idle).
  if (isNew) {
    return { stroke: EDGE_COLOR_IDLE, animated: false };
  }

  // Edge colour follows the SOURCE node — the edge represents data
  // that flowed out of the source. If the source succeeded the edge
  // is green, even when the target later fails. Only edges *leaving*
  // the failed node turn red.

  if (sourceStatus === "error")
    return { stroke: EDGE_COLOR_ERROR, animated: false };

  if (sourceStatus === "completed") {
    // If the target is actively running, animate the edge to show flow
    if (targetStatus === "running") {
      return { stroke: EDGE_COLOR_ACTIVE, animated: true };
    }
    // Otherwise it's fully complete
    return { stroke: EDGE_COLOR_COMPLETED, animated: false };
  }

  if (sourceStatus === "running")
    return { stroke: EDGE_COLOR_ACTIVE, animated: true };

  // Idle (pending) state
  // If the run hasn't started yet, or this edge is downstream of a failure,
  // it remains dimmed and solid.
  return { stroke: EDGE_COLOR_IDLE, animated: false };
}

const edgeTypes = { default: DeletableEdge };

const NODE_DEFAULTS: Record<string, Record<string, unknown>> = {
  input: { label: "User Input", text: "" },
  output: { label: "Output" },
  llm: {
    label: "LLM",
    deploy_id: "",
    prompt_template: "{input}",
    temperature: 0.7,
    max_tokens: 1024,
  },
  rag_query: { label: "RAG Query", collection_name: "", n_results: 5 },
  agent: { label: "Agent", goal: "", thread_id: "" },
};

let nextId = 1;
function generateId(type: string) {
  return `${type}-${Date.now()}-${nextId++}`;
}

export default function WorkflowCanvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    setSelectedNode,
    setSelectedEdge,
    deleteSelected,
    selectedNodeId,
    selectedEdgeId,
    nodeStatuses,
    isRunning,
  } = useWorkflowStore();

  /* Derive per-edge style from execution state */
  const styledEdges = useMemo(
    () =>
      edges.map((edge) => {
        const srcStatus: NodeStatus = nodeStatuses[edge.source] || "idle";
        const tgtStatus: NodeStatus = nodeStatuses[edge.target] || "idle";
        const isNew = Boolean(edge.data?.isNew);
        const { stroke, animated } = getEdgeStyle(srcStatus, tgtStatus, isNew);
        return {
          ...edge,
          animated,
          style: { ...edge.style, stroke },
        };
      }),
    [edges, nodeStatuses, isRunning]
  );

  const onNodeClick: NodeMouseHandler<WorkflowNode> = useCallback(
    (_event, node) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      setSelectedEdge(edge.id);
    },
    [setSelectedEdge]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, [setSelectedNode, setSelectedEdge]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        (selectedNodeId || selectedEdgeId)
      ) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, selectedEdgeId, deleteSelected]);

  const onDragOver: DragEventHandler<HTMLDivElement> = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop: DragEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(
        "application/workflow-node-type"
      ) as WorkflowNodeType;
      if (!type || !NODE_DEFAULTS[type]) return;

      const bounds = (
        event.target as HTMLElement
      ).closest(".react-flow")?.getBoundingClientRect();
      if (!bounds) return;

      const position = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };

      const newNode: WorkflowNode = {
        id: generateId(type),
        type,
        position,
        data: { ...NODE_DEFAULTS[type] } as WorkflowNode["data"],
      };

      addNode(newNode);
    },
    [addNode]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={styledEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={onPaneClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode="dark"
      fitView
      defaultEdgeOptions={{
        animated: true,
        style: { stroke: EDGE_COLOR_DEFAULT },
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#333" gap={20} />
      <Controls />
      <MiniMap
        nodeColor={() => "#7c3aed"}
        maskColor="rgba(0, 0, 0, 0.7)"
      />
    </ReactFlow>
  );
}
