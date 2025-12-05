// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  video?: string;
}

export interface VideoGenerationChatProps {
  onBack: () => void;
  modelID: string;
  initialPrompt?: string;
}
