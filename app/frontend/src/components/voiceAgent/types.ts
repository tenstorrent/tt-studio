// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export type PipelineStage =
  | "idle"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "done";

export interface DeployedModel {
  id: string;
  modelName: string;
  model_type?: string;
}

export interface DeployedModelState {
  whisper: DeployedModel | null;
  llm: DeployedModel | null;
  tts: DeployedModel | null;
}

export interface PipelineMetrics {
  stt_latency_ms?: number;
  llm_ttfb_ms?: number;
  llm_total_ms?: number;
  llm_tokens?: number;
  tts_latency_ms?: number;
  total_ms?: number;
}

export interface ConversationMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  date: Date;
  audioBlob?: Blob;
  isStreaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  date: Date;
  messages: ConversationMessage[];
}
