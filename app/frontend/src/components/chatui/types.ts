// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC


export interface InputAreaProps {
  textInput: string
  setTextInput: React.Dispatch<React.SetStateAction<string>>
  handleInference: (input: string, files: FileData[]) => void
  isStreaming: boolean
  isListening: boolean
  setIsListening: (isListening: boolean) => void
  files: FileData[]
  setFiles: React.Dispatch<React.SetStateAction<FileData[]>>
}
export interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  files?: FileData[];
  inferenceStats?: InferenceStats;
}
export interface FileData {
  url: any;
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
  name: string;
  blob?: Blob;
}

export interface InferenceRequest {
  deploy_id: string;
  text: string;
  rag_context?: { documents: string[] };
  files?: FileData[];
}

export interface FileData {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
  name: string;
  blob?: Blob;
}

export interface RagDataSource {
  id: string;
  name: string;
  metadata: Record<string, string>;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  inferenceStats?: InferenceStats;
}

export interface Model {
  id: string;
  name: string;
}

export interface InferenceStats {
  user_ttft_s: number; // Time to First Token in seconds
  user_tpot: number; // Time Per Output Token in seconds
  tokens_decoded: number; // Number of tokens decoded
  tokens_prefilled: number; // Number of tokens prefilled
  context_length: number; // Context length
}

export interface InferenceStatsProps {
  stats: InferenceStats | undefined;
}

export interface StreamingMessageProps {
  content: string;
  isStreamFinished: boolean;
}

// Voice input types
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

export interface HistoryPanelProps {
  chatHistory: ChatMessage[][];
  onSelectThread: (index: number) => void;
  onDeleteThread: (index: number) => void;
  onCreateNewThread: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}
