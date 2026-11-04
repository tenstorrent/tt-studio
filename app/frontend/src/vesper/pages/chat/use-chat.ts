// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { runInference } from "@/src/components/chatui/runInference";
import type {
  ChatMessage,
  FileData,
  InferenceRequest,
  RagDataSource,
} from "@/src/components/chatui/types";
import { usePersistentState } from "@/src/components/chatui/usePersistentState";

/** Stored under the same keys as the original chat page, so history carries over. */
export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt?: number;
  updatedAt?: number;
}

export interface ModelSettings {
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  seed: number;
  systemPrompt: string;
  thinking: boolean;
  searchAgent: boolean;
}

export const DEFAULT_SETTINGS: ModelSettings = {
  temperature: 1,
  maxTokens: 1024,
  topP: 0.9,
  topK: 20,
  seed: 0,
  systemPrompt: "",
  thinking: false,
  searchAgent: false,
};

const newThread = (): ChatThread => ({
  id: uuidv4(),
  title: "New chat",
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export function useChat({
  modelId,
  modelName,
  hardwareContext,
  ragDatasource,
  settings,
  supportsThinking,
}: {
  modelId: string | null;
  modelName: string | null;
  hardwareContext: string | null;
  ragDatasource: RagDataSource | undefined;
  settings: ModelSettings;
  supportsThinking: boolean;
}) {
  const [threads, setThreads] = usePersistentState<ChatThread[]>(
    "chat_threads",
    [newThread()]
  );
  const [currentIndex, setCurrentIndex] = usePersistentState<number>(
    "current_thread_index",
    0
  );
  const [streaming, setStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const safeThreads = useMemo(
    () =>
      Array.isArray(threads) && threads.length > 0 ? threads : [newThread()],
    [threads]
  );
  const index =
    currentIndex >= 0 && currentIndex < safeThreads.length ? currentIndex : 0;
  const thread = safeThreads[index];

  const updateMessages = useCallback(
    (
      threadId: string,
      next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
    ) =>
      setThreads((prev) =>
        (Array.isArray(prev) ? prev : []).map((t) => {
          if (t.id !== threadId) return t;
          const messages =
            typeof next === "function" ? next(t.messages ?? []) : next;
          // the streamed reply arrives without an id; give it one
          const last = messages[messages.length - 1];
          const fixed =
            last && last.sender === "assistant" && !last.id
              ? [...messages.slice(0, -1), { ...last, id: uuidv4() }]
              : messages;
          return { ...t, messages: fixed, updatedAt: Date.now() };
        })
      ),
    [setThreads]
  );

  const infer = useCallback(
    async (
      target: ChatThread,
      history: ChatMessage[],
      text: string,
      files: FileData[]
    ) => {
      if (!modelId) return;
      const controller = new AbortController();
      controllerRef.current = controller;
      const request: InferenceRequest = {
        deploy_id: modelId,
        text,
        files,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        top_p: settings.topP,
        top_k: settings.topK,
        ...(settings.seed > 0 && { seed: settings.seed }),
        ...(supportsThinking && {
          chat_template_kwargs: { enable_thinking: settings.thinking },
        }),
        stream_options: { include_usage: true, continuous_usage_stats: true },
      };
      setStreaming(true);
      try {
        await runInference(
          request,
          ragDatasource,
          history,
          (next) => updateMessages(target.id, next),
          setStreaming,
          settings.searchAgent,
          safeThreads.findIndex((t) => t.id === target.id),
          controller,
          settings.systemPrompt || null,
          hardwareContext,
          modelName
        );
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          console.error("Chat inference failed:", err);
        }
      } finally {
        controllerRef.current = null;
        setStreaming(false);
      }
    },
    [
      modelId,
      modelName,
      hardwareContext,
      ragDatasource,
      settings,
      supportsThinking,
      safeThreads,
      updateMessages,
    ]
  );

  const send = useCallback(
    async (text: string, files: FileData[] = []) => {
      if (!modelId || streaming || (!text.trim() && files.length === 0)) return;
      const userMessage: ChatMessage = {
        id: uuidv4(),
        sender: "user",
        text: text.trim(),
        files,
        ragDatasource,
      };
      const history = [...(thread.messages ?? []), userMessage];
      setThreads((prev) =>
        (Array.isArray(prev) ? prev : []).map((t) =>
          t.id === thread.id
            ? {
                ...t,
                title: t.messages?.length
                  ? t.title
                  : text.trim().slice(0, 48) || "New chat",
                messages: history,
                updatedAt: Date.now(),
              }
            : t
        )
      );
      await infer(thread, history, text.trim(), files);
    },
    [modelId, streaming, thread, ragDatasource, setThreads, infer]
  );

  /** Re-run the last reply. */
  const regenerate = useCallback(async () => {
    const messages = thread.messages ?? [];
    const lastUser = [...messages].reverse().find((m) => m.sender === "user");
    if (!lastUser || streaming) return;
    const history = messages.slice(0, messages.lastIndexOf(lastUser) + 1);
    updateMessages(thread.id, history);
    await infer(thread, history, lastUser.text, lastUser.files ?? []);
  }, [thread, streaming, updateMessages, infer]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStreaming(false);
  }, []);

  const startNewChat = useCallback(() => {
    // reuse an empty chat rather than piling them up
    const emptyIndex = safeThreads.findIndex(
      (t) => (t.messages ?? []).length === 0
    );
    if (emptyIndex >= 0) {
      setCurrentIndex(emptyIndex);
      return;
    }
    setThreads((prev) => [newThread(), ...(Array.isArray(prev) ? prev : [])]);
    setCurrentIndex(0);
  }, [safeThreads, setThreads, setCurrentIndex]);

  const selectThread = useCallback(
    (id: string) => {
      const i = safeThreads.findIndex((t) => t.id === id);
      if (i >= 0) setCurrentIndex(i);
    },
    [safeThreads, setCurrentIndex]
  );

  const deleteThread = useCallback(
    (id: string) => {
      const remaining = safeThreads.filter((t) => t.id !== id);
      setThreads(remaining.length > 0 ? remaining : [newThread()]);
      setCurrentIndex(0);
    },
    [safeThreads, setThreads, setCurrentIndex]
  );

  return {
    threads: safeThreads,
    thread,
    streaming,
    send,
    regenerate,
    stop,
    startNewChat,
    selectThread,
    deleteThread,
  };
}
