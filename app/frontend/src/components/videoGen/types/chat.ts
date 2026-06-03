// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface VideoMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  video?: string;
  imagePreview?: string;
}

export interface VideoGenChatProps {
  onBack: () => void;
  modelID: string;
  initialPrompt?: string;
}
