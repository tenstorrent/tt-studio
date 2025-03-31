// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export function generatePrompt(
  chatHistory: { sender: string; text: string }[],
  ragContext: { documents: string[] } | null = null
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // Get the latest user question
  const latestUserQuestion =
    chatHistory.length > 0 &&
    chatHistory[chatHistory.length - 1].sender === "user"
      ? chatHistory[chatHistory.length - 1].text
      : "";

  // Choose appropriate examples based on question type
  let examples = "";
  if (
    latestUserQuestion.toLowerCase().includes("how") ||
    latestUserQuestion.toLowerCase().includes("process")
  ) {
    examples = `Example:
Question: How does the authentication process work?
Context: [Document 1] Users are authenticated using JWT tokens stored in browser local storage.
[Document 2] The authentication flow requires sending credentials to /api/auth endpoint.
Answer: Based on Documents 1 and 2, the authentication process works by sending user credentials to the /api/auth endpoint, which then provides JWT tokens that are stored in the browser's local storage.`;
  } else if (latestUserQuestion.toLowerCase().includes("why")) {
    examples = `Example:
Question: Why was this feature implemented?
Context: [Document 3] The rag-unified endpoint was created to combine search results and LLM responses in a single call to improve performance.
Answer: According to Document 3, this feature was implemented to improve performance by combining search results and LLM responses in a single call.`;
  }

  // Enhanced RAG context with examples
  if (ragContext && ragContext.documents.length > 0) {
    const formattedDocuments = ragContext.documents
      .map((doc, index) => `[Document ${index + 1}]\n${doc}`)
      .join("\n\n");

    messages.push({
      role: "system",
      content: `You are a research assistant that provides accurate answers based on the given information.

CONTEXT INFORMATION:
---------------------
${formattedDocuments}
---------------------

${examples ? `EXAMPLES:\n${examples}\n\n` : ""}

INSTRUCTIONS:
1. Use ONLY information from the provided context to answer the user's question
2. If the context doesn't contain the information needed, say "I don't have enough information to answer this question" 
3. Cite which document(s) you used in your answer using [Document X] notation
4. Be concise and focus on directly answering the user's question
5. Think step-by-step before providing your final answer`,
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
