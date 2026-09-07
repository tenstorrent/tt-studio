// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useCallback, useRef, useEffect } from "react";
import { VideoMessage, VideoGenPhase, VideoGenProgress } from "../types/chat";
import {
  submitVideoGeneration,
  getVideoStatus,
  downloadVideo,
} from "../api/videoGeneration";

const POLL_INTERVAL_MS = 2000;
const MAX_GENERATION_MS = 15 * 60 * 1000;

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
  const [progress, setProgress] = useState<VideoGenProgress | null>(null);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);

  // Timers / loop guards, kept in refs so cleanup is reliable.
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number | null>(null); // ms epoch when the job was submitted
  const phaseRef = useRef<VideoGenPhase>("queued");

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  const appendBot = useCallback(
    (text: string, video?: string) => {
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-${prev.length}`, sender: "bot", text, video },
      ]);
    },
    []
  );

  // Recompute the elapsed clock from the submit-time anchor.
  const updateElapsed = useCallback(() => {
    if (startedAtRef.current == null) return;
    const elapsedSeconds = Math.max(0, (Date.now() - startedAtRef.current) / 1000);
    setProgress({ phase: phaseRef.current, elapsedSeconds });
  }, []);

  const finishGeneration = useCallback(() => {
    clearTimers();
    startedAtRef.current = null;
    setProgress(null);
    setIsGenerating(false);
  }, [clearTimers]);

  const sendMessage = useCallback(
    async (input: string) => {
      if (input.trim() === "" || isGenerating) return;

      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), sender: "user", text: input },
      ]);
      setTextInput("");

      setIsGenerating(true);
      phaseRef.current = "queued";
      setProgress({ phase: "queued", elapsedSeconds: 0 });

      try {
        const result = await submitVideoGeneration(input, modelID);

        // Sync mode: the video came back immediately, no polling needed.
        if (result.kind === "video") {
          appendBot("Here's the generated video:", result.videoUrl);
          finishGeneration();
          return;
        }

        const { jobId } = result;
        const submittedAt = Date.now();

        // Anchor the elapsed clock at submit so it reports the true generation
        // time, even if the job jumps straight from queued to completed.
        startedAtRef.current = submittedAt;
        tickTimerRef.current = setInterval(updateElapsed, 1000);

        const stop = (message: string) => {
          finishGeneration();
          appendBot(message);
        };

        pollTimerRef.current = setInterval(async () => {
          if (Date.now() - submittedAt > MAX_GENERATION_MS) {
            stop("Error: video generation timed out.");
            return;
          }
          try {
            const phase = await getVideoStatus(jobId, modelID);

            // Advance the label once the job is actually running.
            if (phase === "in_progress" && phaseRef.current === "queued") {
              phaseRef.current = "in_progress";
              updateElapsed();
            }

            if (phase === "completed") {
              clearTimers();
              try {
                const videoUrl = await downloadVideo(jobId, modelID);
                appendBot("Here's the generated video:", videoUrl);
              } catch {
                appendBot("Error: failed to download the generated video.");
              }
              finishGeneration();
            } else if (phase === "failed" || phase === "cancelled") {
              stop(
                phase === "cancelled"
                  ? "Video generation was cancelled."
                  : "Error: video generation failed."
              );
            }
          } catch {
            // Transient poll error — keep polling until the max-duration guard fires.
          }
        }, POLL_INTERVAL_MS);
      } catch (error) {
        finishGeneration();
        appendBot(
          `Error: ${error instanceof Error ? error.message : "Failed to generate video"}`
        );
      }
    },
    [isGenerating, modelID, appendBot, finishGeneration, updateElapsed, clearTimers]
  );

  // Clear any running timers on unmount.
  useEffect(() => clearTimers, [clearTimers]);

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
    progress,
    isScrollButtonVisible,
    setIsScrollButtonVisible,
    viewportRef,
    lastMessageRef,
    sendMessage,
    scrollToBottom,
    handleScroll,
  };
};
