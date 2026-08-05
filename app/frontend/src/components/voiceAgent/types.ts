// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export type PipelineStage =
  | "idle"
  | "recording"
  | "transcribing"
  | "retrieving"
  | "searching"
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
  rag_latency_ms?: number;
  rag_doc_count?: number;
  rag_used?: boolean;
  rag_collection?: string;
  web_search_used?: boolean;
}

export interface SourceLink {
  title: string;
  url: string;
}

export interface ConversationMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  date: Date;
  audioBlob?: Blob;
  isStreaming?: boolean;
  /** Web sources the Search Agent cited for this turn. */
  sources?: SourceLink[];
  /** Search queries the agent ran while answering, shown live and after. */
  searchQueries?: string[];
  /** Collection this turn was grounded in, when RAG was on. */
  ragCollection?: string;
  /** Per-turn pipeline timings, shown under the answer. */
  metrics?: PipelineMetrics;
}

export interface Conversation {
  id: string;
  title: string;
  date: Date;
  messages: ConversationMessage[];
  /** Stable id for the agent service's per-conversation memory. */
  threadId: number;
}
