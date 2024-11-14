// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { InferenceRequest, RagDataSource, ChatMessage } from "./types";
import { getRagContext } from "./getRagContext";
import { renderPrompt } from "./templateRenderer";

export const runInference = async (
  request: InferenceRequest,
  ragDatasource: RagDataSource | undefined,
  chatHistory: ChatMessage[],
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
) => {
  try {
    setIsStreaming(true);

    // Step 1: Get the RAG context if available
    if (ragDatasource) {
      console.log("Fetching RAG context for the given request...");
      request.rag_context = await getRagContext(request, ragDatasource);
      console.log("RAG context fetched:", request.rag_context);
    }

    // Step 2: Render the prompt using Nunjucks with the updated chat history
    const prompt = renderPrompt(
      chatHistory.map((message) => ({
        role: message.sender,
        content: message.text,
      })),
    );

    console.log("Rendered Prompt:", prompt);

    // Prepare the request body for the API
    const API_URL = import.meta.env.VITE_API_URL || "/models-api/inference/";
    const AUTH_TOKEN = import.meta.env.VITE_AUTH_TOKEN || "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (AUTH_TOKEN) {
      headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
    }

    const requestBody = {
      model: "meta-llama/Meta-Llama-3.1-70B",
      prompt: prompt,
      temperature: 1,
      top_k: 20,
      top_p: 0.9,
      max_tokens: 512,
      stream: true,
      stop: ["<|eot_id|>"],
    };

    console.log(
      "Sending request to model:",
      JSON.stringify(requestBody, null, 2),
    );

    const response = await fetch(API_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    // Add a placeholder for the assistant's response
    setChatHistory((prevHistory) => [
      ...prevHistory,
      { sender: "assistant", text: "" },
    ]);

    if (reader) {
      let done = false;
      while (!done) {
        const { done: streamDone, value } = await reader.read();
        done = streamDone;

        if (value) {
          // Decode value into text
          buffer += decoder.decode(value, { stream: true });
          console.log("Decoded buffer:", buffer);

          // Split the buffer into lines
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep the incomplete line in the buffer

          for (const line of lines) {
            const trimmedLine = line.trim();
            console.log("Processing line:", trimmedLine);

            if (trimmedLine === "data: [DONE]") {
              console.log("Received [DONE] signal, ending stream.");
              done = true;
              break;
            }

            if (trimmedLine.startsWith("data: ")) {
              try {
                const jsonData = trimmedLine.slice(6); // Remove "data: " prefix
                console.log("Extracted JSON string:", jsonData);
                const json = JSON.parse(jsonData);
                const content = json.choices[0]?.text || "";

                console.log("Parsed content from model:", content);

                // Update chat history in real-time with the current assistant's response
                setChatHistory((prevHistory) => {
                  const updatedHistory = [...prevHistory];
                  updatedHistory[updatedHistory.length - 1].text += content;
                  console.log("Updated chat history:", updatedHistory);
                  return updatedHistory;
                });
              } catch (error) {
                console.error("Failed to parse JSON:", error);
                console.error("Problematic JSON string:", trimmedLine.slice(6));
              }
            }
          }
        }
      }
    }

    console.log("Inference stream ended.");
    setIsStreaming(false);
  } catch (error) {
    console.error("Error running inference:", error);
    setIsStreaming(false);
  }
};
