// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { create } from "zustand";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  NodeStatus,
  SSEEvent,
} from "../types/workflow";
import {
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  listTemplates,
  executeWorkflow,
} from "../api/workflowApi";

export interface WorkflowState {
  // Workflow list
  workflows: Workflow[];
  templates: Workflow[];
  isLoading: boolean;

  // Current canvas
  currentWorkflow: Workflow | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;

  // Execution
  isRunning: boolean;
  nodeStatuses: Record<string, NodeStatus>;
  nodeOutputs: Record<string, string>;
  agentReasoningLog: Record<string, string[]>;
  runProgress: number;
  runError: string | null;
  abortController: AbortController | null;

  // Actions – CRUD
  loadWorkflows: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  createWorkflow: (name: string, description?: string, blank?: boolean) => Promise<Workflow>;
  saveWorkflow: () => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
  setCurrentWorkflow: (wf: Workflow | null) => void;
  loadFromTemplate: (template: Workflow) => void;

  // Actions – canvas manipulation
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (node: WorkflowNode) => void;
  setSelectedNode: (id: string | null) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  deleteSelected: () => void;

  // Actions – execution
  runWorkflow: (input: string) => void;
  cancelRun: () => void;
  handleSSEEvent: (event: SSEEvent) => void;
  resetExecution: () => void;

  // Actions – examples
  loadExampleWorkflow: () => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  templates: [],
  isLoading: false,

  currentWorkflow: null,
  nodes: [],
  edges: [],
  selectedNodeId: null,

  isRunning: false,
  nodeStatuses: {},
  nodeOutputs: {},
  agentReasoningLog: {},
  runProgress: 0,
  runError: null,
  abortController: null,

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  loadWorkflows: async () => {
    set({ isLoading: true });
    try {
      const workflows = await listWorkflows();
      set({ workflows });
    } finally {
      set({ isLoading: false });
    }
  },

  loadTemplates: async () => {
    try {
      const templates = await listTemplates();
      set({ templates });
    } catch {
      // templates are optional
    }
  },

  createWorkflow: async (name, description = "", blank = false) => {
    const { nodes, edges } = get();
    const graph_data = blank ? { nodes: [], edges: [] } : { nodes, edges };
    const wf = await createWorkflow({
      name,
      description,
      graph_data,
    });
    set((s) => ({
      workflows: [wf, ...s.workflows],
      currentWorkflow: wf,
      ...(blank ? { nodes: [], edges: [], selectedNodeId: null } : {}),
    }));
    if (blank) get().resetExecution();
    return wf;
  },

  saveWorkflow: async () => {
    const { currentWorkflow, nodes, edges } = get();
    if (!currentWorkflow) return;
    const updated = await updateWorkflow(currentWorkflow.id, {
      name: currentWorkflow.name,
      description: currentWorkflow.description,
      graph_data: { nodes, edges },
    });
    set((s) => ({
      currentWorkflow: updated,
      workflows: s.workflows.map((w) => (w.id === updated.id ? updated : w)),
    }));
  },

  deleteWorkflow: async (id) => {
    await deleteWorkflow(id);
    set((s) => ({
      workflows: s.workflows.filter((w) => w.id !== id),
      currentWorkflow:
        s.currentWorkflow?.id === id ? null : s.currentWorkflow,
    }));
  },

  setCurrentWorkflow: (wf) => {
    if (wf) {
      set({
        currentWorkflow: wf,
        nodes: (wf.graph_data?.nodes ?? []) as WorkflowNode[],
        edges: (wf.graph_data?.edges ?? []) as WorkflowEdge[],
        selectedNodeId: null,
      });
    } else {
      set({
        currentWorkflow: null,
        nodes: [],
        edges: [],
        selectedNodeId: null,
      });
    }
    get().resetExecution();
  },

  loadFromTemplate: (template) => {
    set({
      currentWorkflow: null,
      nodes: (template.graph_data?.nodes ?? []) as WorkflowNode[],
      edges: (template.graph_data?.edges ?? []) as WorkflowEdge[],
      selectedNodeId: null,
    });
    get().resetExecution();
  },

  // -----------------------------------------------------------------------
  // Canvas
  // -----------------------------------------------------------------------

  onNodesChange: (changes) => {
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes) as WorkflowNode[],
    }));
  },

  onEdgesChange: (changes) => {
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges),
    }));
  },

  onConnect: (connection) => {
    set((s) => ({
      edges: addEdge(connection, s.edges),
    }));
  },

  addNode: (node) => {
    set((s) => ({ nodes: [...s.nodes, node] }));
  },

  setSelectedNode: (id) => {
    set({ selectedNodeId: id });
  },

  updateNodeData: (nodeId, data) => {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
    }));
  },

  deleteSelected: () => {
    const { selectedNodeId } = get();
    if (!selectedNodeId) return;
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== selectedNodeId),
      edges: s.edges.filter(
        (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
      ),
      selectedNodeId: null,
    }));
  },

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  runWorkflow: (input) => {
    const { currentWorkflow, nodes, edges } = get();
    if (!currentWorkflow) return;

    get().resetExecution();
    set({ isRunning: true });

    const controller = executeWorkflow(
      currentWorkflow.id,
      input,
      { nodes, edges },
      (event) => get().handleSSEEvent(event),
      () => set({ isRunning: false }),
      (err) => set({ isRunning: false, runError: err.message })
    );

    set({ abortController: controller });
  },

  cancelRun: () => {
    const { abortController } = get();
    abortController?.abort();
    set({ isRunning: false, abortController: null });
  },

  handleSSEEvent: (event) => {
    const nodeId = event.node_id as string | undefined;

    switch (event.event) {
      case "node_started":
        if (nodeId) {
          set((s) => ({
            nodeStatuses: { ...s.nodeStatuses, [nodeId]: "running" },
          }));
        }
        break;

      case "node_progress":
        if (nodeId) {
          const token = (event as Record<string, unknown>).token as string;
          if (token) {
            set((s) => ({
              nodeOutputs: {
                ...s.nodeOutputs,
                [nodeId]: (s.nodeOutputs[nodeId] || "") + token,
              },
            }));
          }
        }
        break;

      case "agent_reasoning":
        if (nodeId) {
          const text = (event as Record<string, unknown>).text as string;
          if (text) {
            set((s) => ({
              agentReasoningLog: {
                ...s.agentReasoningLog,
                [nodeId]: [...(s.agentReasoningLog[nodeId] || []), text],
              },
            }));
          }
        }
        break;

      case "node_done":
        if (nodeId) {
          const output = (event as Record<string, unknown>).output as string;
          set((s) => ({
            nodeStatuses: { ...s.nodeStatuses, [nodeId]: "completed" },
            nodeOutputs: { ...s.nodeOutputs, [nodeId]: output ?? "" },
          }));
        }
        break;

      case "node_completed":
        if (nodeId) {
          const progress = (event as Record<string, unknown>)
            .progress as number;
          set((s) => ({
            nodeStatuses: { ...s.nodeStatuses, [nodeId]: "completed" },
            runProgress: progress ?? s.runProgress,
          }));
        }
        break;

      case "node_error":
        if (nodeId) {
          const error = (event as Record<string, unknown>).error as string;
          set((s) => ({
            nodeStatuses: { ...s.nodeStatuses, [nodeId]: "error" },
            runError: error,
          }));
        }
        break;

      case "run_error":
        set({
          isRunning: false,
          runError: (event as Record<string, unknown>).error as string,
        });
        break;

      case "run_completed":
        set({ isRunning: false, runProgress: 1 });
        break;
    }
  },

  resetExecution: () => {
    set({
      isRunning: false,
      nodeStatuses: {},
      nodeOutputs: {},
      agentReasoningLog: {},
      runProgress: 0,
      runError: null,
      abortController: null,
    });
  },

  loadExampleWorkflow: () => {
    const nodes: WorkflowNode[] = [
      {
        id: "input-1",
        type: "input",
        position: { x: 50, y: 200 },
        data: { label: "User Prompt", text: "" },
      },
      {
        id: "llm-1",
        type: "llm",
        position: { x: 350, y: 80 },
        data: {
          label: "Research LLM",
          deploy_id: "",
          prompt_template:
            "You are a research assistant. Given the following topic, provide a comprehensive summary with key facts:\n\n{input}",
          temperature: 0.7,
          max_tokens: 1024,
        },
      },
      {
        id: "rag-1",
        type: "rag_query",
        position: { x: 350, y: 320 },
        data: {
          label: "Knowledge Base",
          collection_name: "",
          n_results: 5,
        },
      },
      {
        id: "llm-2",
        type: "llm",
        position: { x: 700, y: 200 },
        data: {
          label: "Synthesizer",
          deploy_id: "",
          prompt_template:
            "Combine the following research and retrieved knowledge into a clear, well-structured briefing:\n\nResearch: {input}\n\nProvide a final briefing with sections: Summary, Key Points, and Recommendations.",
          temperature: 0.5,
          max_tokens: 2048,
        },
      },
      {
        id: "output-1",
        type: "output",
        position: { x: 1020, y: 200 },
        data: { label: "Research Briefing" },
      },
    ];

    const edges: WorkflowEdge[] = [
      {
        id: "e-input-llm",
        source: "input-1",
        target: "llm-1",
      },
      {
        id: "e-input-rag",
        source: "input-1",
        target: "rag-1",
      },
      {
        id: "e-llm-synth",
        source: "llm-1",
        target: "llm-2",
      },
      {
        id: "e-rag-synth",
        source: "rag-1",
        target: "llm-2",
      },
      {
        id: "e-synth-output",
        source: "llm-2",
        target: "output-1",
      },
    ];

    set({
      currentWorkflow: null,
      nodes,
      edges,
      selectedNodeId: null,
    });
    get().resetExecution();
  },
}));
