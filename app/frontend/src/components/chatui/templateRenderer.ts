// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// Simple greeting patterns for fast detection
const SIMPLE_GREETINGS = new Set([
  "hi",
  "hello",
  "hey",
  "hiya",
  "greetings",
  "good morning",
  "good afternoon",
  "good evening",
  "howdy",
  "sup",
  "what's up",
  "whats up",
  "yo",
]);

function isSimpleGreeting(message: string): boolean {
  const cleaned = message
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "");
  return SIMPLE_GREETINGS.has(cleaned);
}

function generateSimpleGreetingResponse(
  chatHistory: { sender: string; text: string }[],
  systemPrompt: string | null = null,
  hardwareContext: string | null = null
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // Use custom system prompt if provided, otherwise default greeting prompt
  const defaultGreeting = hardwareContext
    ? `You are a helpful AI assistant running on ${hardwareContext}. Respond to greetings in a friendly, brief manner.`
    : "You are a helpful AI assistant. Respond to greetings in a friendly, brief manner.";
  messages.push({
    role: "system",
    content: systemPrompt || defaultGreeting,
  });

  // Add chat history
  chatHistory.forEach((message) => {
    messages.push({
      role: message.sender === "user" ? "user" : "assistant",
      content: message.text,
    });
  });

  return messages;
}

export function buildDefaultSystemPrompt(
  modelName: string | null,
  hardwareContext: string | null
): string {
  const parts = [
    modelName ? `You are ${modelName}.` : "You are a helpful AI assistant.",
    hardwareContext ? `This instance is running on ${hardwareContext}.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

export function generatePrompt(
  chatHistory: { sender: string; text: string }[],
  ragContext: { documents: string[] } | null = null,
  systemPrompt: string | null = null,
  hardwareContext: string | null = null,
  modelName: string | null = null
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // Get the latest user question
  const latestUserQuestion =
    chatHistory.length > 0 &&
    chatHistory[chatHistory.length - 1].sender === "user"
      ? chatHistory[chatHistory.length - 1].text
      : "";

  // Check for simple greetings first for faster responses
  if (isSimpleGreeting(latestUserQuestion)) {
    console.log("👋 Detected simple greeting, using fast path");
    return generateSimpleGreetingResponse(
      chatHistory,
      systemPrompt,
      hardwareContext
    );
  }

  // Add system message first — keep default aligned with what Model Parameters displays
  const identityLine = buildDefaultSystemPrompt(modelName, hardwareContext);
  const hasRagDocuments = Boolean(
    ragContext && ragContext.documents.length > 0
  );
  const resolvedSystemPrompt =
    systemPrompt ||
    (hasRagDocuments
      ? `${identityLine}

SAFETY GUIDELINES:
• Only answer if you are confident and the information is in your training or the provided context
• Do NOT guess or make up answers
• If unsure, reply with: "I'm not sure — please upload a document or ask a human reviewer"
• Format replies with markdown, bullet points, and code blocks where applicable`
      : identityLine);
  messages.push({
    role: "system",
    content: resolvedSystemPrompt,
  });

  // Add RAG context if available
  if (ragContext && ragContext.documents.length > 0) {
    console.log("📚 RAG Context Available:", {
      documentCount: ragContext.documents.length,
      firstDocumentPreview: ragContext.documents[0].substring(0, 100) + "...",
    });

    // Process and format RAG documents with source attribution
    const formattedDocuments = ragContext.documents
      .map((docContent) => {
        // Extract source name and content
        // [\s\S] instead of . so multi-line chunk bodies are captured too.
        const sourceMatch = docContent.match(
          /^\[From\s+([^\]]+)\]\s*([\s\S]*)$/
        );
        if (sourceMatch) {
          const [, source, content] = sourceMatch;
          return `[Source: ${source}]\n${content.trim()}`;
        }
        return docContent;
      })
      .join("\n\n---\n\n");

    // Add context to system message with improved formatting and instructions
    messages[0].content += `

RELEVANT CONTEXT:
----------------
${formattedDocuments}
----------------

CONTEXT INSTRUCTIONS:
• Use ONLY the provided context to inform your response
• Always cite the source file name when using specific information
• If context is insufficient, acknowledge this and suggest uploading relevant documents
• Do not make assumptions beyond what's in the context
• If multiple sources conflict, acknowledge the conflict and explain the different perspectives`;
  }

  // Add chat history
  chatHistory.forEach((message) => {
    messages.push({
      role: message.sender === "user" ? "user" : "assistant",
      content: message.text,
    });
  });

  console.log("📤 Final Messages Being Sent:", messages);
  return messages;
}
