// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, type DragEventHandler } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas-overrides.css";

import { useWorkflowStore } from "../../store/workflowStore";
import { nodeTypes } from "./nodes/nodeTypes";
import type { WorkflowNodeType, WorkflowNode } from "../../types/workflow";

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
    deleteSelected,
    selectedNodeId,
  } = useWorkflowStore();

  const onNodeClick: NodeMouseHandler<WorkflowNode> = useCallback(
    (_event, node) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, deleteSelected]);

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
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      nodeTypes={nodeTypes}
      colorMode="dark"
      fitView
      defaultEdgeOptions={{
        animated: true,
        style: { stroke: "#7c3aed" },
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
