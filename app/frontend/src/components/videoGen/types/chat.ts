// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface VideoMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  video?: string;
}

export interface VideoGenChatProps {
  onBack: () => void;
  modelID: string;
  initialPrompt?: string;
}

export type VideoGenPhase =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export interface VideoGenProgress {
  phase: VideoGenPhase;
  elapsedSeconds: number;
  estimatedSeconds: number;
  percent: number;
}
