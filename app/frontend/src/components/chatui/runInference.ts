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
    // Step 1: Set streaming to true
    setIsStreaming(true);

    // Step 2: Get the RAG context if available
    if (ragDatasource) {
      request.rag_context = await getRagContext(request, ragDatasource);
    }

    // Step 3: Render the prompt using Nunjucks with updated chat history
    const prompt = renderPrompt(
      [...chatHistory, { role: "user", content: request.text }].map(
        (message) => ({
          role: message.sender,
          content: message.text,
        }),
      ),
    );

    console.log("Rendered Prompt:", prompt);

    // Step 4: Prepare request body
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

    // Step 5: Send request to model
    const response = await fetch(API_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    const reader = response.body?.getReader();

    // Step 6: Immediately add placeholder for assistant response
    setChatHistory((prevHistory) => [
      ...prevHistory,
      { sender: "assistant", text: "" },
    ]);

    let result = "";
    if (reader) {
      let done = false;
      while (!done) {
        const { done: streamDone, value } = await reader.read();
        done = streamDone;

        if (value) {
          const chunk = new TextDecoder().decode(value);
          const parsedChunk = chunk.replace(/^data: /, "").trim();

          if (parsedChunk === "[DONE]") {
            console.log("Received [DONE] signal, ending stream.");
            break;
          }

          console.log("Received chunk from model:", parsedChunk);

          if (parsedChunk.startsWith("{") && parsedChunk.endsWith("}")) {
            try {
              const jsonData = JSON.parse(parsedChunk);
              const content = jsonData.choices[0]?.text || "";
              result += content;

              // Update chat history in real-time with the current assistant's response
              setChatHistory((prevHistory) => {
                const updatedHistory = [...prevHistory];
                updatedHistory[updatedHistory.length - 1] = {
                  ...updatedHistory[updatedHistory.length - 1],
                  text: result,
                };
                return updatedHistory;
              });
            } catch (e) {
              console.error("Failed to parse JSON:", e);
            }
          } else {
            console.warn("Skipped non-JSON chunk:", parsedChunk);
          }
        }
      }
    }

    console.log("Final assembled response from model:", result);
    setIsStreaming(false);
  } catch (error) {
    console.error("Error running inference:", error);
    setIsStreaming(false);
  }
};
