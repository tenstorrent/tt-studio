// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { processQuery } from "./textProcessing";

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

  console.log("📝 Original User Query:", latestUserQuestion);

  // Process the user's query
  const processedQuery = processQuery(latestUserQuestion);
  console.log("🔍 Processed Query Results:", {
    processed: processedQuery.processed,
    expanded: processedQuery.expanded,
    intent: processedQuery.intent,
  });

  // Log detailed intent information
  console.log("🎯 Detailed Intent Information:", {
    type: processedQuery.intent.type,
    action: processedQuery.intent.action,
    details: processedQuery.intent.details,
    rawIntent: processedQuery.intent,
  });

  // Choose appropriate examples based on question type and intent
  let examples = "";
  if (processedQuery.intent.type === "question") {
    console.log("❓ Detected Question Type:", processedQuery.intent.type);
    if (processedQuery.intent.action === "debug") {
      console.log("🐛 Detected Debug Action");
      examples = `Example:
Question: How do I fix the authentication error?
Context: [tt-auth] Users are authenticated using JWT tokens stored in browser local storage.
[auth-flow] The authentication flow requires sending credentials to /api/auth endpoint.
Answer: To fix the authentication error, ensure you're sending valid credentials to /api/auth endpoint. The system uses JWT tokens stored in browser local storage for authentication.`;
    } else if (processedQuery.intent.action === "deploy") {
      console.log("🚀 Detected Deploy Action");
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
    content:
      processedQuery.intent.type === "greeting" || !processedQuery.intent.action
        ? "You are a friendly AI assistant. Keep responses warm and natural."
        : `You are a friendly and helpful AI assistant. Start conversations warmly and maintain a conversational tone.

GUIDELINES:
• Be friendly and conversational
• Provide helpful responses based on available information
• Ask for clarification if needed
• Keep responses natural and engaging

RESPONSE FORMAT:
${responseFormat}`,
  });

  // Add RAG context if available
  if (ragContext && ragContext.documents.length > 0) {
    console.log("📚 RAG Context Available:", {
      documentCount: ragContext.documents.length,
      firstDocumentPreview: ragContext.documents[0].substring(0, 100) + "...",
    });

    // Extract source names from the documents format [From source-name]
    const formattedDocuments = ragContext.documents
      .map((docContent) => {
        // Remove the [From source-name] prefix if it exists
        return docContent.replace(/^\[From\s+[^\]]+\]\s*/, "");
      })
      .join("\n\n");

    // Add context to system message
    messages[0].content += `

CONTEXT INFORMATION:
---------------------
${formattedDocuments}
---------------------`;
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

function getResponseFormat(intent: { type: string; action?: string }): string {
  if (intent.action === "debug") {
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
