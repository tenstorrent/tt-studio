// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useCallback, useRef, useEffect } from "react";
import { Message } from "../types/chat";
import { generateImage } from "../api/imageGeneration";

export const useChat = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      sender: "bot",
      text: "Hello! I can generate images based on your descriptions. What would you like me to create?",
    },
  ]);
  const [textInput, setTextInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);

  const sendMessage = useCallback(
    async (textInput: string) => {
      if (textInput.trim() !== "" && !isGenerating) {
        const userMessage: Message = {
          id: Date.now().toString(),
          sender: "user",
          text: textInput,
        };
        setMessages((prev) => [...prev, userMessage]);
        setTextInput("");

        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: "Generating your image...",
        };
        setMessages((prev) => [...prev, botMessage]);

        setIsGenerating(true);
        try {
          const generatedImageUrl = await generateImage(textInput);

          const imageMessage: Message = {
            id: (Date.now() + 2).toString(),
            sender: "bot",
            text: "Here's the generated image:",
            image: generatedImageUrl,
          };
          setMessages((prev) => [...prev, imageMessage]);
        } catch (error) {
          const errorMessage: Message = {
            id: (Date.now() + 2).toString(),
            sender: "bot",
            text: `Error: ${error instanceof Error ? error.message : "Failed to generate image"}`,
          };
          setMessages((prev) => [...prev, errorMessage]);
        } finally {
          setIsGenerating(false);
        }
      }
    },
    [isGenerating]
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
