// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
export interface InferenceRequest {
  deploy_id: string;
  text: string;
  rag_context?: { documents: string[] };
}

export interface RagDataSource {
  id: string;
  name: string;
  metadata: Record<string, string>;
}

export interface ChatMessage {
  sender: "user" | "assistant";
  text: string;
  inferenceStats?: InferenceStats;
}

export interface Model {
  id: string;
  name: string;
}

export interface InferenceStats {
  user_ttft_ms: number;
  user_tps: number;
  user_ttft_e2e_ms: number;
  prefill: {
    tokens_prefilled: number;
    tps: number;
  };
  decode: {
    tokens_decoded: number;
    tps: number;
  };
  batch_size: number;
  context_length: number;
}
export interface StreamingMessageProps {
  content: string; // The actual content of the message (text or code)
  isStreamFinished: boolean; // Indicates whether the streaming of the message is complete
}

export interface StreamingMessageProps {
  content: string;
  isStreamFinished: boolean;
}
