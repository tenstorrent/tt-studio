// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export type LogSourceStatus = "pending" | "loading" | "done" | "error";

export interface LogEntry {
  file: string | null;
  content: string;
}

export interface BugReportData {
  backend_log: LogEntry;
  fastapi_log: LogEntry;
  fastapi_deployment_logs: LogEntry[];
  docker_control_log: LogEntry;
  startup_log: LogEntry;
  agent_log: { content: string };
  inference_run_logs: LogEntry[];
  inference_docker_server_logs: LogEntry[];
  inference_run_specs: LogEntry[];
  tt_smi: Record<string, unknown>;
  deployments: unknown[];
}

export type BugReportStep = "form" | "collecting" | "actions";

export interface BugReportForm {
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
}

export interface LogSourceState {
  label: string;
  key: string;
  status: LogSourceStatus;
}
