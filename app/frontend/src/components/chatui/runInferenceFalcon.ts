// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type React from "react";
import type { InferenceRequest, RagDataSource, ChatMessage } from "./types";
import { v4 as uuidv4 } from "uuid";
import { generateFalconJWT } from "./jwt";

export const runInferenceFalcon = async (
  request: InferenceRequest,
  _ragDatasource: RagDataSource | undefined,
  chatHistory: ChatMessage[],
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
  _isAgentSelected: boolean,
  threadId: number,
  _abortController?: AbortController
) => {
  console.log("[FALCON] runInferenceFalcon called", {
    request,
    threadId,
  });

  setIsStreaming(true);

  try {
    // Create assistant message placeholder (user message is already added by ChatComponent)
    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      sender: "assistant",
      text: "",
    };

    // Add only the assistant message placeholder to chat history
    setChatHistory((prev) => [...prev, assistantMessage]);

    // Prepare simple messages array (like your curl command)
    const messages = [
      ...chatHistory.map((msg) => ({
        role: msg.sender,
        content: msg.text,
      })),
      {
        role: "user",
        content: request.text,
      },
    ];

    // Generate JWT token for authentication
    const jwtToken = await generateFalconJWT();
    console.log("[FALCON] Generated JWT token");

    // Direct API call to localhost:7000 (exactly like your curl)
    const API_URL = "http://127.0.0.1:7000/v1/chat/completions";
    console.log("[FALCON] Calling API:", API_URL);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwtToken}`,
    };

    // Simple request body (exactly like your curl)
    const requestBody = {
      model: "tiiuae/Falcon3-7B-Instruct",
      messages: messages,
      temperature: request.temperature || 0.9,
      max_tokens: request.max_tokens || 128,
    };

    console.log("[FALCON] Request body:", JSON.stringify(requestBody, null, 2));

    const response = await fetch(API_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log("[FALCON] Response received. Status:", response.status);

    // Get the response as JSON (non-streaming, like your curl)
    const responseData = await response.json();
    console.log("[FALCON] Response data:", responseData);

    // Extract the content from the response
    const content =
      responseData.choices?.[0]?.message?.content || "No response";

    // Update the assistant message with the response
    setChatHistory((prev) =>
      prev.map((msg) =>
        msg.id === assistantMessage.id ? { ...msg, text: content } : msg
      )
    );

    console.log("[FALCON] Inference completed successfully");
    console.log("[FALCON] Response content:", content);
  } catch (error) {
    console.error("[FALCON] Error during inference:", error);

    // Add error message to chat
    const errorMessage: ChatMessage = {
      id: uuidv4(),
      sender: "assistant",
      text: `Error: ${error instanceof Error ? error.message : "Unknown error occurred"}`,
    };

    setChatHistory((prev) => [...prev, errorMessage]);
  } finally {
    setIsStreaming(false);
  }
};
