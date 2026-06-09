// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
export interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  image?: string;
}

export interface StableDiffusionChatProps {
  onBack: () => void;
  modelID: string;
  initialPrompt?: string;
}
