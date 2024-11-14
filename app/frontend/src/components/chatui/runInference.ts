// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { InferenceRequest, RagDataSource, ChatMessage } from "./types.ts";
import { getRagContext } from "./getRagContext";

export const runInference = async (
  request: InferenceRequest,
  ragDatasource: RagDataSource | undefined,
  textInput: string,
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
) => {
  try {
    if (ragDatasource) {
      request.rag_context = await getRagContext(request, ragDatasource);
    }

    setIsStreaming(true);

    const API_URL = import.meta.env.VITE_API_URL || "/models-api/inference/";
    const AUTH_TOKEN = import.meta.env.VITE_AUTH_TOKEN || "";

    // Build headers, including Authorization only if AUTH_TOKEN is present
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (AUTH_TOKEN) {
      headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
    }

    // Prepare the request body
    const requestBody = {
      model: "meta-llama/Meta-Llama-3.1-70B",
      prompt: textInput,
      temperature: 1,
      top_k: 20,
      top_p: 0.9,
      max_tokens: 512,
      stream: true,
      stop: ["<|eot_id|>"],
    };

    // Log the request body
    console.log(
      "Sending request to model:",
      JSON.stringify(requestBody, null, 2),
    );

    const response = await fetch(API_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    const reader = response.body?.getReader();
    setChatHistory((prevHistory) => [
      ...prevHistory,
      { sender: "user", text: textInput },
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

          // Log each chunk received from the model
          console.log("Received chunk from model:", parsedChunk);

          try {
            const jsonData = JSON.parse(parsedChunk);
            const content = jsonData.choices[0].text || "";
            result += content;
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
        }
      }
    }

    // Log the final assembled response
    console.log("Final assembled response from model:", result);

    setIsStreaming(false);
  } catch (error) {
    console.error("Error running inference:", error);
    setIsStreaming(false);
  }
};
