// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Node, Edge } from "@xyflow/react";

export type WorkflowNodeType =
  | "input"
  | "output"
  | "llm"
  | "rag_query"
  | "agent";

export interface InputNodeData extends Record<string, unknown> {
  label: string;
  text: string;
}

export interface OutputNodeData extends Record<string, unknown> {
  label: string;
}

export interface LLMNodeData extends Record<string, unknown> {
  label: string;
  deploy_id: string;
  prompt_template: string;
  temperature: number;
  max_tokens: number;
}

export interface RAGNodeData extends Record<string, unknown> {
  label: string;
  collection_name: string;
  n_results: number;
}

export interface AgentNodeData extends Record<string, unknown> {
  label: string;
  goal: string;
  thread_id: string;
}

export type WorkflowNode = Node<
  | InputNodeData
  | OutputNodeData
  | LLMNodeData
  | RAGNodeData
  | AgentNodeData,
  WorkflowNodeType
>;

export type WorkflowEdge = Edge;

export interface GraphData {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  graph_data: GraphData;
  is_template: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: string;
  workflow: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  initial_input: string;
  node_outputs: Record<string, string>;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export type NodeStatus = "idle" | "running" | "completed" | "error";

export interface SSEEvent {
  event: string;
  node_id?: string;
  [key: string]: unknown;
}
