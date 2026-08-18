// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import axios from "axios";
import {
  ChatMessage,
  InferenceRequest,
  RagDataSource,
  RetrieveResponse,
} from "./types.ts";

const MAX_HISTORY_TURNS = 4;
const MAX_HISTORY_CHARS = 500;

// Recent conversation turns, oldest first, for server-side query rewriting.
// The trailing turn duplicating the current query is dropped.
const buildChatHistory = (
  chatHistory: Pick<ChatMessage, "sender" | "text">[] | undefined,
  currentText: string,
) => {
  if (!chatHistory?.length) return undefined;
  const turns = chatHistory
    .filter((m) => m.text && m.text.trim())
    .map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.text.slice(0, MAX_HISTORY_CHARS),
    }));
  if (turns.length && turns[turns.length - 1].content === currentText.slice(0, MAX_HISTORY_CHARS)) {
    turns.pop();
  }
  const recent = turns.slice(-MAX_HISTORY_TURNS);
  return recent.length ? recent : undefined;
};

export const getRagContext = async (
  request: InferenceRequest,
  ragDatasource: RagDataSource | undefined,
  chatHistory?: Pick<ChatMessage, "sender" | "text">[],
): Promise<{ documents: string[] }> => {
  const ragContext: { documents: string[] } = { documents: [] };

  if (!ragDatasource) return ragContext;

  // This must never throw: the voice pipeline advances on this call resolving,
  // so any retrieval failure degrades to an ungrounded answer instead.
  try {
    const browserId = localStorage.getItem("tt_studio_browser_id");
    const response = await axios.post<RetrieveResponse>(
      "/collections-api/retrieve",
      {
        query_text: request.text,
        // "special-all" is keyed by id — the voice picker names it differently.
        collection:
          ragDatasource.id === "special-all" ? null : ragDatasource.name,
        chat_history: buildChatHistory(chatHistory, request.text),
      },
      { headers: { "X-Browser-ID": browserId } },
    );

    const data = response?.data;
    if (Array.isArray(data?.documents)) {
      ragContext.documents = data.documents.filter(
        (d): d is string => typeof d === "string",
      );
    } else if (Array.isArray(data?.results)) {
      ragContext.documents = data.results
        .map((r) => r?.text)
        .filter((t): t is string => typeof t === "string");
    }
    if (data?.query?.rewritten) {
      console.log(
        `RAG query rewritten: "${data.query.original}" -> "${data.query.effective}"`,
      );
    }
  } catch (error) {
    console.error("Error fetching RAG context:", error);
  }

  return ragContext;
};
