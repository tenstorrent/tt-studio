// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios from "axios";

const TRAINING_API = "/training-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  id: string;
  name: string;
  description?: string;
  default_config?: Record<string, unknown>;
}

export interface TrainingJob {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "cancelled";
  model: string;
  dataset: string;
  config: Record<string, unknown>;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  progress?: { current_step: number; total_steps: number };
}

export interface TrainingMetricPoint {
  global_step: number;
  train_loss?: number;
  val_loss?: number;
  learning_rate?: number;
  epoch?: number;
  [key: string]: number | undefined;
}

export interface TrainingLogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface TrainingCheckpoint {
  id: string;
  step: number;
  epoch?: number;
  metrics?: Record<string, number>;
  created_at: string;
  size_bytes?: number;
}

export interface CreateTrainingJobParams {
  model: string;
  dataset: string;
  learning_rate?: number;
  batch_size?: number;
  num_epochs?: number;
  max_steps?: number;
  lora_rank?: number;
  lora_alpha?: number;
  lora_target_modules?: string[];
  val_steps_freq?: number;
  save_interval?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchTrainingCatalog(): Promise<CatalogEntry[]> {
  const { data } = await axios.get(`${TRAINING_API}/catalog/`);
  if (Array.isArray(data)) return data;
  if (data?.catalog) return data.catalog;
  if (data?.entries) return data.entries;
  return [];
}

export async function fetchTrainingJobs(): Promise<TrainingJob[]> {
  const { data } = await axios.get(`${TRAINING_API}/jobs/`);
  if (Array.isArray(data)) return data;
  if (data?.jobs) return data.jobs;
  return [];
}

export async function createTrainingJob(
  params: CreateTrainingJobParams,
): Promise<TrainingJob> {
  const { data } = await axios.post(`${TRAINING_API}/jobs/`, params);
  return data;
}

export async function fetchTrainingJob(jobId: string): Promise<TrainingJob> {
  const { data } = await axios.get(`${TRAINING_API}/jobs/${jobId}/`);
  return data;
}

export async function fetchTrainingJobMetrics(
  jobId: string,
): Promise<TrainingMetricPoint[]> {
  const { data } = await axios.get(`${TRAINING_API}/jobs/${jobId}/metrics/`);
  if (Array.isArray(data)) return data;
  if (data?.metrics) return data.metrics;
  return [];
}

export async function fetchTrainingJobLogs(
  jobId: string,
): Promise<TrainingLogEntry[]> {
  const { data } = await axios.get(`${TRAINING_API}/jobs/${jobId}/logs/`);
  if (Array.isArray(data)) return data;
  if (data?.logs) return data.logs;
  return [];
}

export async function fetchTrainingJobCheckpoints(
  jobId: string,
): Promise<TrainingCheckpoint[]> {
  const { data } = await axios.get(
    `${TRAINING_API}/jobs/${jobId}/checkpoints/`,
  );
  if (Array.isArray(data)) return data;
  if (data?.checkpoints) return data.checkpoints;
  return [];
}

export async function cancelTrainingJob(
  jobId: string,
): Promise<{ status: string }> {
  const { data } = await axios.post(
    `${TRAINING_API}/jobs/${jobId}/cancel/`,
  );
  return data;
}

export function getCheckpointDownloadUrl(
  jobId: string,
  ckptId: string,
): string {
  return `${TRAINING_API}/jobs/${jobId}/checkpoints/${ckptId}/`;
}
