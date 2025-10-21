// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
// File and Media Types
export interface ImageUrl {
  url: string;
  detail?: string;
}

export interface FileData {
  id?: string;
  name: string;
  type: "text" | "image_url" | "document" | "audio" | "video";
  size?: number;
  created_at?: string;
  blob?: Blob;
  url?: string;
  mime_type?: string;
  duration?: number;
  thumbnail_url?: string;

  // Type-specific fields
  text?: string;
  image_url?: ImageUrl;
  document_url?: string;
  audio_url?: string;
  video_url?: string;
}

// Chat and Message Types
export interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  files?: FileData[];
  inferenceStats?: InferenceStats;
  ragDatasource?: RagDataSource;
  isStopped?: boolean;
}

export type MessageContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    };

export type InferenceMessage = {
  role: "user" | "assistant";
  content: MessageContent[];
};

// RAG Types
export interface RagDataSource {
  id: string;
  name: string;
  metadata?: {
    created_at?: string;
    embedding_func_name?: string;
    last_uploaded_document?: string;
  };
}

// Inference Types
export interface InferenceRequest {
  deploy_id: string;
  text: string;
  files?: FileData[];
  temperature?: number; // 0-2, default 1
  max_tokens?: number; // 1-2048, default 512
  top_p?: number; // 0-1, default 0.9
  top_k?: number; // 1-100, default 20
  stream_options?: {
    include_usage: boolean;
    continuous_usage_stats: boolean;
  };
}

export interface InferenceStats {
  user_ttft_s?: number;
  user_tpot?: number;
  tokens_decoded?: number;
  tokens_prefilled?: number;
  context_length?: number;
  startTime?: string;
  endTime?: string;
  totalDuration?: number;
  tokensPerSecond?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  total_time_ms?: number;
}

// Component Props Types
export interface InputAreaProps {
  textInput: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  handleInference: (input: string, files: FileData[]) => void;
  isStreaming: boolean;
  isListening: boolean;
  setIsListening: (isListening: boolean) => void;
  files: FileData[];
  setFiles: React.Dispatch<React.SetStateAction<FileData[]>>;
}

export interface InferenceStatsProps {
  stats: InferenceStats | undefined;
  modelName?: string | null;
}

export interface StreamingMessageProps {
  content: string;
  isStreamFinished: boolean;
}

export interface HistoryPanelProps {
  chatHistory: ChatMessage[][];
  onSelectThread: (index: number) => void;
  onDeleteThread: (index: number) => void;
  onCreateNewThread: () => void;
}

export interface FileDisplayProps {
  files: FileData[];
  minimizedFiles: Set<string>;
  toggleMinimizeFile: (fileId: string) => void;
  onFileClick: (fileUrl: string, fileName: string) => void;
}

export interface FileViewerDialogProps {
  file: { url: string; name: string; isImage: boolean } | null;
  onClose: () => void;
}

// Voice Input Types
export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}

export interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

export interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

export interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

export interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export interface VoiceInputProps {
  onTranscript: (transcript: string) => void;
  isListening: boolean;
  setIsListening: (isListening: boolean) => void;
}

// Model Types
export interface Model {
  id?: string;
  containerID?: string;
  name?: string;
  modelName?: string;
  modelSize?: string;
  baseModel?: string;
  task?: string;
  status?: string;
}

// Global Type Declarations
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}
