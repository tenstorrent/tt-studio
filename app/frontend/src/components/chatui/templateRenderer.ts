// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export function generatePrompt(
  chatHistory: { sender: string; text: string }[],
  ragContext: { documents: string[] } | null = null,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // Add system message
  messages.push({
    role: "system",
    content: "You are a helpful assistant.",
  });

  // Add RAG context if available
  if (ragContext && ragContext.documents.length > 0) {
    messages.push({
      role: "system",
      content: `Use the given context to answer the prompt:\n\n${ragContext.documents.join("\n\n")}`,
    });
  }

  // Add chat history
  chatHistory.forEach((message) => {
    messages.push({
      role: message.sender === "user" ? "user" : "assistant",
      content: message.text,
    });
  });

  return messages;
}
