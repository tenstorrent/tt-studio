// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useCallback, useRef, useEffect } from "react";
import { Message } from "../types/chat";
import { generateImage } from "../api/imageGeneration";
import { imageChatStore, useImageChatState } from "../imageChatStore";

const addMessage = (message: Message) =>
  imageChatStore.update((s) => ({ messages: [...s.messages, message] }));

export const useChat = (modelID: string) => {
  const { messages, isGenerating } = useImageChatState();
  const [textInput, setTextInput] = useState("");
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);

  const sendMessage = useCallback(
    async (textInput: string) => {
      if (textInput.trim() !== "" && !imageChatStore.get().isGenerating) {
        addMessage({
          id: Date.now().toString(),
          sender: "user",
          text: textInput,
        });
        setTextInput("");

        addMessage({
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: "Generating your image...",
        });

        // Written to the store, not component state, so the result still shows
        // if the page was unmounted and remounted while the request ran.
        imageChatStore.update(() => ({ isGenerating: true }));
        try {
          const generatedImageUrl = await generateImage(textInput, modelID);
          addMessage({
            id: (Date.now() + 2).toString(),
            sender: "bot",
            text: "Here's the generated image:",
            image: generatedImageUrl,
          });
        } catch (error) {
          addMessage({
            id: (Date.now() + 2).toString(),
            sender: "bot",
            text: `Error: ${error instanceof Error ? error.message : "Failed to generate image"}`,
          });
        } finally {
          imageChatStore.update(() => ({ isGenerating: false }));
        }
      }
    },
    [modelID]
  );

  const scrollToBottom = useCallback(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (viewportRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
      const isAtBottom = scrollHeight - scrollTop <= clientHeight + 1;
      setIsScrollButtonVisible(!isAtBottom);
    }
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.addEventListener("scroll", handleScroll);
      return () => viewport.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  useEffect(() => {
    if (!isGenerating) {
      const viewport = viewportRef.current;
      if (viewport) {
        const { scrollTop, scrollHeight, clientHeight } = viewport;
        const isAtBottom = scrollHeight - scrollTop <= clientHeight + 1;
        if (isAtBottom) {
          scrollToBottom();
        }
        setIsScrollButtonVisible(!isAtBottom);
      }
    }
  }, [messages, isGenerating, scrollToBottom]);

  return {
    messages,
    textInput,
    setTextInput,
    isGenerating,
    isScrollButtonVisible,
    setIsScrollButtonVisible,
    viewportRef,
    lastMessageRef,
    sendMessage,
    scrollToBottom,
    handleScroll,
  };
};
