// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useCallback, useRef, useEffect } from "react";
import { VideoMessage } from "../types/chat";
import { generateVideo } from "../api/videoGeneration";

export const useVideoChat = (modelID: string) => {
  const [messages, setMessages] = useState<VideoMessage[]>([
    {
      id: "1",
      sender: "bot",
      text: "Hello! I can generate videos based on your descriptions. What would you like me to create?",
    },
  ]);
  const [textInput, setTextInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);

  const sendMessage = useCallback(
    async (input: string) => {
      if (input.trim() === "" || isGenerating) return;

      const userMessage: VideoMessage = {
        id: Date.now().toString(),
        sender: "user",
        text: input,
      };
      setMessages((prev) => [...prev, userMessage]);
      setTextInput("");

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: "Generating your video... This may take 1–5 minutes.",
        },
      ]);

      setIsGenerating(true);
      try {
        const videoUrl = await generateVideo(input, modelID);
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 2).toString(),
            sender: "bot",
            text: "Here's the generated video:",
            video: videoUrl,
          },
        ]);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 2).toString(),
            sender: "bot",
            text: `Error: ${error instanceof Error ? error.message : "Failed to generate video"}`,
          },
        ]);
      } finally {
        setIsGenerating(false);
      }
    },
    [isGenerating, modelID]
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
