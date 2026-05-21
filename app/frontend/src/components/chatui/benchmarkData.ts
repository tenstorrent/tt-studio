// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface GpuBenchmark {
  gpu: string;
  tps: number;
  tdp_watts: number;
  tps_per_watt: number;
  source?: string;
}

export interface ModelBenchmarkEntry {
  benchmarks: GpuBenchmark[];
}

/**
 * Reference GPU performance numbers for common LLM models.
 *
 * Values represent single-request (batch=1) output throughput from published
 * benchmarks (vLLM, Anyscale, MLPerf, independent reviews). TDP is the rated
 * board power, not measured idle draw.
 *
 * Keys are normalised model identifiers that matchModelName() maps to.
 */
export const MODEL_BENCHMARKS: Record<string, ModelBenchmarkEntry> = {
  "llama-3.1-8b": {
    benchmarks: [
      {
        gpu: "NVIDIA A100 80GB",
        tps: 75,
        tdp_watts: 300,
        tps_per_watt: 0.25,
        source: "https://blog.vllm.ai/2024/09/05/perf-update.html",
      },
      {
        gpu: "NVIDIA H100 SXM",
        tps: 120,
        tdp_watts: 700,
        tps_per_watt: 0.17,
        source: "https://blog.vllm.ai/2024/09/05/perf-update.html",
      },
    ],
  },
  "llama-3.2-1b": {
    benchmarks: [
      {
        gpu: "NVIDIA A100 80GB",
        tps: 160,
        tdp_watts: 300,
        tps_per_watt: 0.53,
      },
      {
        gpu: "NVIDIA H100 SXM",
        tps: 250,
        tdp_watts: 700,
        tps_per_watt: 0.36,
      },
    ],
  },
  "llama-3.2-3b": {
    benchmarks: [
      {
        gpu: "NVIDIA A100 80GB",
        tps: 115,
        tdp_watts: 300,
        tps_per_watt: 0.38,
      },
      {
        gpu: "NVIDIA H100 SXM",
        tps: 185,
        tdp_watts: 700,
        tps_per_watt: 0.26,
      },
    ],
  },
  "llama-3.3-70b": {
    benchmarks: [
      {
        gpu: "NVIDIA A100 80GB",
        tps: 18,
        tdp_watts: 300,
        tps_per_watt: 0.06,
        source: "https://blog.vllm.ai/2024/09/05/perf-update.html",
      },
      {
        gpu: "NVIDIA H100 SXM",
        tps: 35,
        tdp_watts: 700,
        tps_per_watt: 0.05,
        source: "https://blog.vllm.ai/2024/09/05/perf-update.html",
      },
    ],
  },
  "mistral-7b": {
    benchmarks: [
      {
        gpu: "NVIDIA A100 80GB",
        tps: 80,
        tdp_watts: 300,
        tps_per_watt: 0.27,
      },
      {
        gpu: "NVIDIA H100 SXM",
        tps: 130,
        tdp_watts: 700,
        tps_per_watt: 0.19,
      },
    ],
  },
  "falcon-7b": {
    benchmarks: [
      {
        gpu: "NVIDIA A100 80GB",
        tps: 70,
        tdp_watts: 300,
        tps_per_watt: 0.23,
      },
      {
        gpu: "NVIDIA H100 SXM",
        tps: 115,
        tdp_watts: 700,
        tps_per_watt: 0.16,
      },
    ],
  },
  "falcon-40b": {
    benchmarks: [
      {
        gpu: "NVIDIA A100 80GB",
        tps: 22,
        tdp_watts: 300,
        tps_per_watt: 0.07,
      },
      {
        gpu: "NVIDIA H100 SXM",
        tps: 45,
        tdp_watts: 700,
        tps_per_watt: 0.06,
      },
    ],
  },
  "qwen-2.5-7b": {
    benchmarks: [
      {
        gpu: "NVIDIA A100 80GB",
        tps: 78,
        tdp_watts: 300,
        tps_per_watt: 0.26,
      },
      {
        gpu: "NVIDIA H100 SXM",
        tps: 125,
        tdp_watts: 700,
        tps_per_watt: 0.18,
      },
    ],
  },
  "qwen-2.5-72b": {
    benchmarks: [
      {
        gpu: "NVIDIA A100 80GB",
        tps: 16,
        tdp_watts: 300,
        tps_per_watt: 0.05,
      },
      {
        gpu: "NVIDIA H100 SXM",
        tps: 32,
        tdp_watts: 700,
        tps_per_watt: 0.05,
      },
    ],
  },
};

/**
 * Normalise a model name string (e.g. "meta-llama/Llama-3.1-8B-Instruct")
 * into the key used by MODEL_BENCHMARKS (e.g. "llama-3.1-8b").
 */
export function matchModelName(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const lower = raw.toLowerCase();

  const patterns: [RegExp, string][] = [
    [/llama[-_. ]?3\.3[-_. ]?70b/i, "llama-3.3-70b"],
    [/llama[-_. ]?3\.2[-_. ]?3b/i, "llama-3.2-3b"],
    [/llama[-_. ]?3\.2[-_. ]?1b/i, "llama-3.2-1b"],
    [/llama[-_. ]?3\.1[-_. ]?8b/i, "llama-3.1-8b"],
    [/llama[-_. ]?3[-_. ]?8b/i, "llama-3.1-8b"],
    [/mistral[-_. ]?7b/i, "mistral-7b"],
    [/falcon[-_. ]?40b/i, "falcon-40b"],
    [/falcon[-_. ]?7b/i, "falcon-7b"],
    [/qwen[-_. ]?2\.5[-_. ]?72b/i, "qwen-2.5-72b"],
    [/qwen[-_. ]?2\.5[-_. ]?7b/i, "qwen-2.5-7b"],
  ];

  for (const [regex, key] of patterns) {
    if (regex.test(lower)) return key;
  }

  return null;
}

/**
 * Look up GPU baselines for a given model name.
 * Returns null when no benchmark data is available for the model.
 */
export function getModelBenchmarks(
  modelName: string | null | undefined,
): GpuBenchmark[] | null {
  const key = matchModelName(modelName);
  if (!key || !MODEL_BENCHMARKS[key]) return null;
  return MODEL_BENCHMARKS[key].benchmarks;
}
