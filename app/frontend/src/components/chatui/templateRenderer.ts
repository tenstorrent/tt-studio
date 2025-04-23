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
Context: [tt-auth] Users are authenticated using JWT tokens stored in browser local storage.
[auth-flow] The authentication flow requires sending credentials to /api/auth endpoint.
Answer: The authentication process works by sending user credentials to the /api/auth endpoint, which then provides JWT tokens that are stored in the browser's local storage.

SOURCES: tt-auth, auth-flow`;
  } else if (latestUserQuestion.toLowerCase().includes("why")) {
    examples = `Example:
Question: Why was this feature implemented?
Context: [endpoints-doc] The rag-unified endpoint was created to combine search results and LLM responses in a single call to improve performance.
Answer: This feature was implemented to improve performance by combining search results and LLM responses in a single call.

SOURCES: endpoints-doc`;
  }

  // Add RAG context if available
  if (ragContext && ragContext.documents.length > 0) {
    // Extract source names from the documents format [From source-name]
    const formattedDocuments = ragContext.documents
      .map((docContent, index) => {
        // Try to extract source name from the document content
        const sourceMatch = docContent.match(/^\[From\s+([^\]]+)\]/);
        const sourceName = sourceMatch ? sourceMatch[1] : `source-${index + 1}`;

        return `[${sourceName}]\n${docContent}`;
      })
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
3. IMPORTANT: Do NOT include any citations within your answer text
4. At the very end of your response, add a "SOURCES:" section that lists ALL sources used, comma-separated
5. Format the sources section like this: "SOURCES: source1, source2, source3"
6. Be concise and focus on directly answering the user's question
7. Think step-by-step before providing your final answer`,
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
