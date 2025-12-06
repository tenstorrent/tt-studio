// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { processQuery } from "./textProcessing";

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
  chatHistory: { sender: string; text: string }[]
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // Simple system message for greetings
  messages.push({
    role: "system",
    content:
      "You are an open source language model running on Tenstorrent hardware. Respond to greetings in a friendly, brief manner.",
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

  // console.log("📝 Original User Query:", latestUserQuestion);

  // Check for simple greetings first for faster responses
  if (isSimpleGreeting(latestUserQuestion)) {
    // console.log("👋 Detected simple greeting, using fast path");
    return generateSimpleGreetingResponse(chatHistory);
  }

  // Process the user's query
  const processedQuery = processQuery(latestUserQuestion);
  // console.log("🔍 Processed Query Results:", {
  //   processed: processedQuery.processed,
  //   expanded: processedQuery.expanded,
  //   intent: processedQuery.intent,
  // });

  // Log detailed intent information
  // console.log("🎯 Detailed Intent Information:", {
  //   type: processedQuery.intent.type,
  //   action: processedQuery.intent.action,
  //   details: processedQuery.intent.details,
  //   rawIntent: processedQuery.intent,
  // });

  // Choose appropriate examples based on question type and intent
  let examples = "";
  if (processedQuery.intent.type === "question") {
    // console.log("❓ Detected Question Type:", processedQuery.intent.type);
    if (processedQuery.intent.action === "debug") {
      // console.log("🐛 Detected Debug Action");
      examples = `Example:
Question: How do I fix the authentication error?
Context: [tt-auth] Users are authenticated using JWT tokens stored in browser local storage.
[auth-flow] The authentication flow requires sending credentials to /api/auth endpoint.
Answer: To fix the authentication error, ensure you're sending valid credentials to /api/auth endpoint. The system uses JWT tokens stored in browser local storage for authentication.`;
    } else if (processedQuery.intent.action === "deploy") {
      // console.log("🚀 Detected Deploy Action");
      examples = `Example:
Question: How do I deploy the application?
Context: [deployment] The application can be deployed using Docker containers.
[config] Environment variables need to be set before deployment.
Answer: To deploy the application, you'll need to set up the required environment variables and use Docker containers for deployment.`;
    }
  }

  const responseFormat = getResponseFormat(processedQuery.intent);

  // Add system message first
  messages.push({
    role: "system",
    content: `You are an open source language model running on Tenstorrent hardware.

SAFETY GUIDELINES:
• Only answer if you are confident and the information is in your training or the provided context
• Do NOT guess or make up answers
• If unsure, reply with: "I'm not sure — please upload a document or ask a human reviewer"
• Format replies with markdown, bullet points, and code blocks where applicable

${examples ? `\nEXAMPLE RESPONSES:\n${examples}\n` : ""}

${
  processedQuery.intent.type === "greeting"
    ? "Keep responses brief and friendly for greetings."
    : `RESPONSE FORMAT:
${responseFormat}`
}`,
  });

  // Add RAG context if available
  if (ragContext && ragContext.documents.length > 0) {
    // console.log("📚 RAG Context Available:", {
    //   documentCount: ragContext.documents.length,
    //   firstDocumentPreview: ragContext.documents[0].substring(0, 100) + "...",
    // });

    // Process and format RAG documents with source attribution
    const formattedDocuments = ragContext.documents
      .map((docContent) => {
        // Extract source name and content
        const sourceMatch = docContent.match(/^\[From\s+([^\]]+)\]\s*(.*)$/);
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

  // console.log("📤 Final Messages Being Sent:", messages);
  return messages;
}

function getResponseFormat(intent: { type: string; action?: string }): string {
  if (intent.type === "greeting") {
    return `Keep it simple and friendly.`;
  } else if (intent.action === "debug") {
    return `• Let's look at what might be causing the issue
• I'll suggest some solutions that could help
• We can walk through the steps together`;
  } else if (intent.action === "deploy") {
    return `• I'll help you get everything set up
• We'll go through the steps one by one
• I'll make sure to cover important settings`;
  } else if (intent.type === "question") {
    return `• I'll answer your question directly
• I'll add helpful context when needed
• Feel free to ask for more details`;
  } else {
    return `• I'll help you with that
• We can explore the topic together
• Let me know if you need more information`;
  }
}
