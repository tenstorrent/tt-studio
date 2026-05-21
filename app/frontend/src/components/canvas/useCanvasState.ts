// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useCallback, useRef, useEffect } from "react";
import { buildCanvasMessages } from "./canvasSystemPrompt";
import type { CanvasFileAttachment } from "./canvasSystemPrompt";
import {
  parseCanvasResponse,
  parseStreamingCode,
} from "./canvasCodeParser";

export interface CanvasChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  files?: Array<{ name: string; url: string }>;
}

export interface CanvasError {
  message: string;
  line?: number;
  col?: number;
}

export type CanvasCreativity = "low" | "medium" | "high";

const STORAGE_KEY = "canvas-session-state";

interface PersistedCanvasState {
  messages: CanvasChatMessage[];
  currentCode: string | null;
  creativity: CanvasCreativity;
}

function loadPersistedState(): PersistedCanvasState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedCanvasState;
  } catch {
    return null;
  }
}

function persistState(state: PersistedCanvasState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable - silently ignore
  }
}

const CREATIVITY_TEMP: Record<CanvasCreativity, number> = {
  low: 0.3,
  medium: 0.7,
  high: 1.0,
};

interface UseCanvasStateReturn {
  messages: CanvasChatMessage[];
  currentCode: string | null;
  isStreaming: boolean;
  streamingText: string;
  streamingThinking: string;
  previewErrors: CanvasError[];
  creativity: CanvasCreativity;
  setCreativity: (c: CanvasCreativity) => void;
  sendMessage: (text: string, files?: CanvasFileAttachment[]) => Promise<void>;
  stopStreaming: () => void;
  resetCanvas: () => void;
  setPreviewErrors: (errors: CanvasError[]) => void;
  setCurrentCode: (code: string | null) => void;
}

let messageCounter = 0;
function nextId(): string {
  return `canvas-msg-${++messageCounter}-${Date.now()}`;
}

/**
 * Configurable model for canvas code generation.
 * Set VITE_CANVAS_MODEL to override (e.g. "Qwen/Qwen2.5-Coder-32B-Instruct").
 */
const CANVAS_MODEL =
  import.meta.env.VITE_CANVAS_MODEL || "meta-llama/Llama-3.3-70B-Instruct";

export function useCanvasState(
  modelId: string | null,
  isAgentSelected: boolean,
): UseCanvasStateReturn {
  const persisted = useRef(loadPersistedState()).current;

  const [messages, setMessages] = useState<CanvasChatMessage[]>(
    persisted?.messages ?? [],
  );
  const [currentCode, setCurrentCode] = useState<string | null>(
    persisted?.currentCode ?? null,
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [previewErrors, setPreviewErrors] = useState<CanvasError[]>([]);
  const [creativity, setCreativity] = useState<CanvasCreativity>(
    persisted?.creativity ?? "medium",
  );

  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    persistState({ messages, currentCode, creativity });
  }, [messages, currentCode, creativity]);

  const stopStreaming = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string, files?: CanvasFileAttachment[]) => {
      if (!text.trim() && (!files || files.length === 0)) return;

      const userMsg: CanvasChatMessage = {
        id: nextId(),
        role: "user",
        content: text,
        files: files?.map((f) => ({ name: f.name, url: f.image_url.url })),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingText("");
      setStreamingThinking("");
      setPreviewErrors([]);

      const controller = new AbortController();
      controllerRef.current = controller;

      const conversationHistory = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      const apiMessages = buildCanvasMessages(
        text,
        currentCode,
        conversationHistory,
        files,
      );

      const apiUrlDefined =
        import.meta.env.VITE_ENABLE_DEPLOYED === "true";
      const API_URL = isAgentSelected
        ? import.meta.env.VITE_SPECIAL_API_URL || "/models-api/agent/"
        : apiUrlDefined
          ? "/models-api/inference_cloud/"
          : "/models-api/inference/";

      const AUTH_TOKEN = import.meta.env.VITE_LLAMA_AUTH_TOKEN || "";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      };
      if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;

      const requestBody: Record<string, unknown> = {
        messages: apiMessages,
        temperature: CREATIVITY_TEMP[creativity],
        max_tokens: 8192,
        top_p: 0.95,
        stream: true,
        stream_options: { include_usage: true, continuous_usage_stats: true },
      };

      if (isAgentSelected) {
        requestBody.deploy_id = modelId || "";
        requestBody.thread_id = "canvas";
      } else if (apiUrlDefined) {
        requestBody.model = CANVAS_MODEL;
      } else {
        requestBody.deploy_id = modelId || "";
      }

      let contentText = "";
      let thinkingText = "";
      let thinkingDone = false;

      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          let done: boolean;
          let value: Uint8Array | undefined;
          try {
            ({ done, value } = await reader.read());
          } catch {
            break;
          }
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            let jsonData: Record<string, unknown>;
            try {
              jsonData = JSON.parse(data);
            } catch {
              continue;
            }

            const choices = jsonData.choices as
              | Array<{
                  delta?: {
                    content?: string;
                    reasoning_content?: string;
                    reasoning?: string;
                    thinking?: string;
                  };
                  text?: string;
                }>
              | undefined;
            const delta = choices?.[0]?.delta;

            // Thinking/reasoning tokens (multi-vendor: reasoning_content, reasoning, thinking)
            const rawReasoning =
              delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking;
            if (typeof rawReasoning === "string" && !thinkingDone) {
              const cleaned = rawReasoning.replace(/<\/?think>/gi, "");
              thinkingText += cleaned;
              setStreamingThinking(thinkingText);
            }

            // Content tokens
            const content =
              (delta?.content as string) ?? choices?.[0]?.text ?? "";
            if (content) {
              if (thinkingText && !thinkingDone) {
                thinkingDone = true;
              }
              contentText += content;

              // Also extract inline <think> blocks from the content stream
              const inlineThink = contentText.match(
                /^<think>([\s\S]*?)(<\/think>|$)/,
              );
              if (inlineThink) {
                const inlineThinkContent = inlineThink[1].trim();
                if (!thinkingText && inlineThinkContent) {
                  thinkingText = inlineThinkContent;
                  setStreamingThinking(thinkingText);
                }
                if (inlineThink[2] === "</think>") {
                  thinkingDone = true;
                  const afterThink = contentText
                    .slice(inlineThink[0].length)
                    .trimStart();
                  setStreamingText(afterThink);
                } else {
                  setStreamingText("");
                }
              } else {
                setStreamingText(contentText);
              }
            }
          }
        }
        reader.releaseLock();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // User-initiated stop
        } else {
          const errorMsg: CanvasChatMessage = {
            id: nextId(),
            role: "assistant",
            content: `Error: ${err instanceof Error ? err.message : "Unknown error occurred"}`,
          };
          setMessages((prev) => [...prev, errorMsg]);
          setIsStreaming(false);
          setStreamingText("");
          setStreamingThinking("");
          controllerRef.current = null;
          return;
        }
      }

      // Strip inline <think> blocks from the final content for parsing
      let cleanContent = contentText;
      const thinkBlock = cleanContent.match(
        /^<think>[\s\S]*?<\/think>\s*/,
      );
      if (thinkBlock) {
        cleanContent = cleanContent.slice(thinkBlock[0].length);
      }

      const parsed = parseCanvasResponse(cleanContent || contentText);
      const streamCode =
        parsed.code ?? parseStreamingCode(cleanContent || contentText);

      if (streamCode) {
        setCurrentCode(streamCode);
      }

      const assistantMsg: CanvasChatMessage = {
        id: nextId(),
        role: "assistant",
        content: parsed.explanation || cleanContent || contentText,
        thinking: thinkingText || undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsStreaming(false);
      setStreamingText("");
      setStreamingThinking("");
      controllerRef.current = null;
    },
    [messages, currentCode, modelId, isAgentSelected, creativity],
  );

  const resetCanvas = useCallback(() => {
    stopStreaming();
    setMessages([]);
    setCurrentCode(null);
    setStreamingText("");
    setStreamingThinking("");
    setPreviewErrors([]);
    sessionStorage.removeItem(STORAGE_KEY);
  }, [stopStreaming]);

  return {
    messages,
    currentCode,
    isStreaming,
    streamingText,
    streamingThinking,
    previewErrors,
    creativity,
    setCreativity,
    sendMessage,
    stopStreaming,
    resetCanvas,
    setPreviewErrors,
    setCurrentCode,
  };
}
