// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios from "axios";
import type { Workflow, WorkflowRun, SSEEvent, GraphData } from "../types/workflow";

const BASE = "/workflows-api";

export async function listWorkflows(): Promise<Workflow[]> {
  const { data } = await axios.get<Workflow[]>(`${BASE}/`);
  return data;
}

export async function getWorkflow(id: string): Promise<Workflow> {
  const { data } = await axios.get<Workflow>(`${BASE}/${id}/`);
  return data;
}

export async function createWorkflow(
  payload: Pick<Workflow, "name" | "description" | "graph_data">
): Promise<Workflow> {
  const { data } = await axios.post<Workflow>(`${BASE}/`, payload);
  return data;
}

export async function updateWorkflow(
  id: string,
  payload: Partial<Pick<Workflow, "name" | "description" | "graph_data">>
): Promise<Workflow> {
  const { data } = await axios.put<Workflow>(`${BASE}/${id}/`, payload);
  return data;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await axios.delete(`${BASE}/${id}/`);
}

export async function listTemplates(): Promise<Workflow[]> {
  const { data } = await axios.get<Workflow[]>(`${BASE}/templates/`);
  return data;
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRun> {
  const { data } = await axios.get<WorkflowRun>(`${BASE}/runs/${runId}/`);
  return data;
}

/**
 * Execute a workflow and stream SSE events back.
 * Returns an AbortController so the caller can cancel.
 */
export function executeWorkflow(
  workflowId: string,
  input: string,
  graphData: GraphData,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE}/${workflowId}/run/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, graph_data: graphData }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const raw = trimmed.slice(6);
          if (raw === "[DONE]") {
            onDone();
            return;
          }
          try {
            const parsed = JSON.parse(raw) as SSEEvent;
            onEvent(parsed);
          } catch {
            // skip malformed lines
          }
        }
      }

      onDone();
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError(err);
      }
    });

  return controller;
}
