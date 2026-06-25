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
  supported?: boolean;
}

export interface TrainingJob {
  id: string;
  status:
    | "queued"
    | "in_progress"
    | "completed"
    | "failed"
    | "cancelled"
    | "cancelling";
  model: string;
  // The dataset is not a top-level field on the container's job object; it lives
  // inside `request_parameters.dataset_loader`. Use `getJobDataset()` to read it.
  dataset?: string;
  job_type?: string;
  config?: Record<string, unknown>;
  request_parameters?: Record<string, unknown>;
  // Timestamps are epoch seconds (int) as returned by the training container.
  created_at: number | string;
  started_at?: number | string;
  completed_at?: number | string;
  error?: string | { code?: string; message?: string };
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
  timestamp: number | string;
  // The container emits `type` (e.g. "info", "eval", "error", "checkpoint").
  // `level` is kept for backward compatibility with other shapes.
  type?: string;
  level?: string;
  step?: number;
  message: string;
}

export interface TrainingCheckpoint {
  id: string;
  step: number;
  epoch?: number;
  metrics?: Record<string, number>;
  created_at: number | string;
  size_bytes?: number;
}

// Mirrors the training container's `TrainingRequest` schema. Field names must
// match exactly — the container's pydantic model silently ignores unknown keys,
// so a mismatch (e.g. `dataset` instead of `dataset_loader`) is dropped and the
// server falls back to its defaults rather than honoring the user's input.
export interface CreateTrainingJobParams {
  dataset_loader: string;
  device_type: string;
  learning_rate?: number;
  batch_size?: number;
  num_epochs?: number;
  max_length?: number;
  max_steps?: number;
  lora_r?: number;
  lora_alpha?: number;
  lora_target_modules?: string[];
  steps_freq?: number;
  val_steps_freq?: number;
  save_interval?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

// Normalize the various catalog shapes into a flat CatalogEntry[].
// The tt-media-server training catalog returns
// `{ models: [{ id, display_name, supported, model_config }, ...], ... }`,
// while older/other shapes used a flat array or `catalog`/`entries` keys.
function normalizeCatalogEntries(raw: unknown[]): CatalogEntry[] {
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      id: String(e.id ?? e.name ?? ""),
      name: String(e.name ?? e.display_name ?? e.id ?? ""),
      description:
        typeof e.description === "string" ? e.description : undefined,
      default_config:
        (e.default_config as Record<string, unknown>) ??
        (e.model_config as Record<string, unknown>) ??
        undefined,
      supported: typeof e.supported === "boolean" ? e.supported : undefined,
    }))
    .filter((e) => e.id !== "");
}

function extractModels(data: any): CatalogEntry[] {
  if (Array.isArray(data)) return normalizeCatalogEntries(data);
  if (Array.isArray(data?.models)) return normalizeCatalogEntries(data.models);
  if (Array.isArray(data?.catalog)) return normalizeCatalogEntries(data.catalog);
  if (Array.isArray(data?.entries)) return normalizeCatalogEntries(data.entries);
  return [];
}

export async function fetchTrainingCatalog(): Promise<CatalogEntry[]> {
  const { data } = await axios.get(`${TRAINING_API}/catalog/`);
  return extractModels(data);
}

export interface TrainingCatalog {
  models: CatalogEntry[];
  datasets: CatalogEntry[];
  // The device type the running training container targets (from the catalog's
  // `clusters`). The container rejects job requests whose `device_type` does not
  // match its configured device, so the create-job request must send this value.
  device?: string;
}

// Fetch the full training catalog (models + datasets) in a single request.
// The tt-media-server returns a global dataset list (not scoped per model),
// so the same datasets are available regardless of the selected model.
export async function fetchTrainingCatalogFull(): Promise<TrainingCatalog> {
  const { data } = await axios.get(`${TRAINING_API}/catalog/`);
  const datasets = Array.isArray(data?.datasets)
    ? normalizeCatalogEntries(data.datasets)
    : [];
  const clusters = Array.isArray(data?.clusters) ? data.clusters : [];
  const device =
    clusters.length > 0 && clusters[0]?.id ? String(clusters[0].id) : undefined;
  return { models: extractModels(data), datasets, device };
}

// The training container returns timestamps as epoch *seconds* (int), but other
// fields elsewhere may be ISO strings or epoch milliseconds. `new Date(seconds)`
// would interpret the value as milliseconds and render a 1970 date, so normalize
// here before formatting.
export function formatTrainingTimestamp(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "-";

  let ms: number;
  if (typeof value === "number") {
    ms = value < 1e12 ? value * 1000 : value;
  } else {
    const asNumber = Number(value);
    if (value.trim() !== "" && !Number.isNaN(asNumber)) {
      ms = asNumber < 1e12 ? asNumber * 1000 : asNumber;
    } else {
      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) return "-";
      ms = parsed;
    }
  }

  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

// The dataset is stored inside the job's `request_parameters.dataset_loader`,
// not as a top-level field, so read it from there with a sensible fallback.
export function getJobDataset(job: TrainingJob): string {
  if (job.dataset) return job.dataset;
  const loader = job.request_parameters?.dataset_loader;
  return typeof loader === "string" && loader ? loader : "-";
}

// `error` may be a string or the container's `{ code, message }` object.
export function getJobErrorMessage(
  error: TrainingJob["error"],
): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  return error.message || error.code || "Unknown error";
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
  const raw: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.metrics)
      ? data.metrics
      : [];
  return pivotMetrics(raw);
}

// The container records metrics in long form, one row per metric:
// `{ global_step, epoch, metric_name: "train_loss"|"val_loss", value, learning_rate }`.
// The chart expects wide form keyed by step, so pivot rows that share a step into
// a single point (`{ global_step, train_loss, val_loss, learning_rate, epoch }`).
// Rows already in wide form (no `metric_name`) are passed through unchanged.
function pivotMetrics(raw: unknown[]): TrainingMetricPoint[] {
  const rows = raw.filter(
    (m): m is Record<string, unknown> => !!m && typeof m === "object",
  );
  const isLongForm = rows.some((m) => "metric_name" in m);
  if (!isLongForm) return rows as unknown as TrainingMetricPoint[];

  const byStep = new Map<number, TrainingMetricPoint>();
  for (const m of rows) {
    const step = Number(m.global_step);
    if (!Number.isFinite(step)) continue;
    const point = byStep.get(step) ?? { global_step: step };
    const name = m.metric_name;
    if (typeof name === "string" && typeof m.value === "number") {
      point[name] = m.value;
    }
    if (typeof m.learning_rate === "number") {
      point.learning_rate = m.learning_rate;
    }
    if (typeof m.epoch === "number") {
      point.epoch = m.epoch;
    }
    byStep.set(step, point);
  }
  return Array.from(byStep.values()).sort(
    (a, b) => a.global_step - b.global_step,
  );
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
