// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useCallback, useRef, useEffect } from "react";
import { VideoMessage } from "../types/chat";
import { generateVideoI2V } from "../api/videoGeneration";

export const useVideoI2VChat = (modelID: string) => {
  const [messages, setMessages] = useState<VideoMessage[]>([
    {
      id: "1",
      sender: "bot",
      text: "Hello! Upload an image and I'll animate it into a video. You can also add an optional text description.",
    },
  ]);
  const [textInput, setTextInput] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);

  const sendMessage = useCallback(
    async (input: string, image: File) => {
      if (!image || isGenerating) return;

      // Create a dedicated object URL for the message bubble so revoking
      // the input-area preview URL doesn't break the persisted thumbnail.
      const messagePreviews = URL.createObjectURL(image);
      const userMessage: VideoMessage = {
        id: Date.now().toString(),
        sender: "user",
        text: input || "Generate video from image",
        imagePreview: messagePreviews,
      };
      setMessages((prev) => [...prev, userMessage]);

      setTextInput("");
      setImageFile(null);
      setImagePreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "bot",
          text: "Generating your video from the image... This may take 1–5 minutes.",
        },
      ]);

      setIsGenerating(true);
      try {
        const videoUrl = await generateVideoI2V(input, image, modelID);
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
    [isGenerating, imagePreviewUrl, modelID]
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
    imageFile,
    setImageFile,
    imagePreviewUrl,
    setImagePreviewUrl,
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
