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

  // Add system message first
  messages.push({
    role: "system",
    content: `You are a research assistant that provides accurate answers based on the given information.

QUERY INTENT:
---------------------
Type: ${processedQuery.intent.type}
Action: ${processedQuery.intent.action || "none"}
Key Details: ${processedQuery.intent.details.join(", ")}
---------------------

${examples ? `EXAMPLES:\n${examples}\n\n` : ""}

INSTRUCTIONS:
1. Use ONLY information from the provided context to answer the user's question
2. If the context doesn't contain the information needed, say "I don't have enough information to answer this question" 
3. Be concise and focus on directly answering the user's question
4. Think step-by-step before providing your final answer
5. Structure your response based on the query type and action (e.g., step-by-step for debug, overview for explain)
6. DO NOT mention or reference any sources in your response

RESPONSE FORMAT:
Based on the query intent above, structure your response as follows:
${getResponseFormat(processedQuery.intent)}`,
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
    return `1. Identify the specific issue
2. List possible causes
3. Provide step-by-step troubleshooting steps
4. Include relevant error messages or logs if mentioned`;
  } else if (intent.action === "deploy") {
    return `1. List prerequisites
2. Provide step-by-step deployment instructions
3. Include configuration details
4. Mention any post-deployment steps`;
  } else if (intent.type === "question") {
    return `1. Provide a direct answer
2. Include relevant context
3. Add supporting details
4. Conclude with next steps if applicable`;
  } else {
    return `1. Address the main point
2. Provide supporting information
3. Include relevant context
4. Conclude appropriately`;
  }
}
