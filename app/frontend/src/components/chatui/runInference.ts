// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { InferenceRequest, RagDataSource, ChatMessage } from "./types";
import { getRagContext } from "./getRagContext";
import { generatePrompt } from "./templateRenderer";

export const runInference = async (
  request: InferenceRequest,
  ragDatasource: RagDataSource | undefined,
  chatHistory: ChatMessage[],
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
) => {
  try {
    setIsStreaming(true);

    let ragContext: { documents: string[] } | null = null;

    // Step 1: Get the RAG context if available
    if (ragDatasource) {
      console.log("Fetching RAG context for the given request...");
      ragContext = await getRagContext(request, ragDatasource);
      console.log("RAG context fetched:", ragContext);
    }

    // Add a console.log statement before calling generatePrompt to verify the RAG context
    console.log("RAG context being passed to generatePrompt:", ragContext);

    // Step 2: Generate the prompt using the new generatePrompt function
    const prompt = generatePrompt(
      chatHistory.map((msg) => ({ sender: msg.sender, text: msg.text })),
      ragContext ? { documents: ragContext.documents } : null,
      true,
    );

    console.log("Generated Prompt:", prompt);

    // Prepare the request body for the API
    const API_URL = import.meta.env.VITE_API_URL || "/models-api/inference/";
    const AUTH_TOKEN = import.meta.env.VITE_AUTH_TOKEN || "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (AUTH_TOKEN) {
      headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
    }
    // the model needs to be the deployed vLLM model name
    // future UI exposable params: temperature, top_k, top_p, max_tokens
    const requestBody = {
      model: "meta-llama/Llama-3.1-70B-Instruct",
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

    console.log("Response received. Status:", response.status);
    console.log("Response headers:", response.headers);

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
                const json = JSON.parse(jsonData);
                const content = json.choices[0]?.text || "";

                // Update chat history in real-time with the current assistant's response
                setChatHistory((prevHistory) => {
                  const updatedHistory = [...prevHistory];
                  updatedHistory[updatedHistory.length - 1].text += content;
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
