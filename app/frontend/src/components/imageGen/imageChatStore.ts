// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useSyncExternalStore } from "react";
import { Message } from "./types/chat";

// The image chat lives outside React so it survives the page being unmounted.
// The app tears its whole tree down while the backend looks unreachable and
// rebuilds it once /up/ answers again, and a slow generation can easily outlast
// that. With the conversation, the gallery/chat toggle and the in-flight flag
// kept here, the remounted page picks up where it left off and the image still
// lands when the request returns.
interface ImageChatState {
  showChat: boolean;
  messages: Message[];
  isGenerating: boolean;
}

let state: ImageChatState = {
  showChat: false,
  messages: [
    {
      id: "1",
      sender: "bot",
      text: "Hello! I can generate images based on your descriptions. What would you like me to create?",
    },
  ],
  isGenerating: false,
};

const listeners = new Set<() => void>();

export const imageChatStore = {
  get: (): ImageChatState => state,
  update(change: (current: ImageChatState) => Partial<ImageChatState>) {
    state = { ...state, ...change(state) };
    listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useImageChatState = (): ImageChatState =>
  useSyncExternalStore(imageChatStore.subscribe, imageChatStore.get);
