// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import type React from "react";
import type { InferenceRequest, RagDataSource, ChatMessage, InferenceStats } from "./types";
import { getRagContext } from "./getRagContext";
import { generatePrompt } from "./templateRenderer";
import { v4 as uuidv4 } from "uuid";
import { processUploadedFiles } from "./processUploadedFiles";


export const runInference = async (
  request: InferenceRequest,
  ragDatasource: RagDataSource | undefined,
  chatHistory: ChatMessage[],
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
  isAgentSelected: boolean,
  threadId: number,
  abortController?: AbortController
) => {
  try {
    setIsStreaming(true);

    console.log("Uploaded files:", request.files);
    console.log("RAG Datasource:", ragDatasource);

    let ragContext: { documents: string[] } | null = null;

    if (ragDatasource) {
      console.log(
        `Fetching RAG context from ${ragDatasource.name ? ragDatasource.name : "all collections"}`
      );
      ragContext = await getRagContext(request, ragDatasource);
      console.log("RAG context fetched:", ragContext);
    }

    let messages;
    if (request.files && request.files.length > 0) {
      const file = processUploadedFiles(request.files);
      console.log("Processed file:", file);

      if (file.type === "text" && file.text) {
        // Handle text file by treating its content as RAG context
        console.log("Text file detected, processing as RAG context");
        const textContent = file.text;
        console.log("Text content:", textContent);

        // Create a RAG context from the text file content
        const fileRagContext = {
          documents: [textContent],
        };

        // Merge with existing RAG context if any
        if (ragContext) {
          ragContext.documents = [...ragContext.documents, ...fileRagContext.documents];
        } else {
          ragContext = fileRagContext;
        }

        // Process with RAG context
        console.log("Processing with combined RAG context:", ragContext);
        messages = generatePrompt(
          chatHistory.map((msg) => ({ sender: msg.sender, text: msg.text })),
          ragContext
        );
      } else if (file.image_url?.url || file) {
        console.log("Image file detected, using image_url message structure", file.image_url?.url);
        messages = [
          {
            role: "user",
            content: [
              { type: "text", text: request.text || "What's in this image?" },
              {
                type: "image_url",
                image_url: {
                  url: file.image_url?.url || file,
                },
              },
            ],
          },
        ];
      }
    } else if (
      request.text &&
      request.text.includes("https://") &&
      request.text.match(/\.(jpeg|jpg|gif|png)$/)
    ) {
      console.log("Image URL detected in the message");
      const match = request.text.match(/(https:\/\/.*\.(jpeg|jpg|gif|png))/);
      if (match) {
        const imageUrl = match[0];
        const userText = request.text.replace(imageUrl, "").trim();
        messages = [
          {
            role: "user",
            content: [
              { type: "text", text: userText || "What's in this image?" },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ];
      } else {
        // Handle the case where no valid image URL is found
        console.error("No valid image URL found in the text");
        messages = [
          {
            role: "user",
            content: [{ type: "text", text: request.text }],
          },
        ];
      }
    } else {
      console.log("RAG context being passed to generatePrompt:", ragContext);
      messages = generatePrompt(
        chatHistory.map((msg) => ({ sender: msg.sender, text: msg.text })),
        ragContext
      );
    }

    console.log("Generated messages:", messages);
    console.log("Thread ID: ", threadId);

    const apiUrlDefined = import.meta.env.VITE_ENABLE_DEPLOYED === "true";

    const API_URL = isAgentSelected
      ? import.meta.env.VITE_SPECIAL_API_URL || "/models-api/agent/"
      : apiUrlDefined
        ? "/models-api/inference_cloud/"
        : "/models-api/inference/";

    console.log("API URL:", API_URL);

    const AUTH_TOKEN = import.meta.env.VITE_LLAMA_AUTH_TOKEN || "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (AUTH_TOKEN) {
      headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
    }

    let requestBody;
    const threadIdStr = threadId.toString();

    if (!isAgentSelected) {
      requestBody = {
        ...(apiUrlDefined ? {} : { deploy_id: request.deploy_id }),
        ...(apiUrlDefined ? { model: "meta-llama/Llama-3.3-70B-Instruct" } : {}),
        messages: messages,
        temperature: request.temperature,
        top_k: request.top_k,
        top_p: request.top_p,
        max_tokens: request.max_tokens,
        stream: true,
        stream_options: {
          include_usage: true,
          continuous_usage_stats: true,
        },
      };
    } else {
      requestBody = {
        deploy_id: request.deploy_id,
        messages: messages,
        temperature: request.temperature,
        top_k: request.top_k,
        top_p: request.top_p,
        max_tokens: request.max_tokens,
        stream: true,
        stream_options: {
          include_usage: true,
          continuous_usage_stats: true,
        },
        thread_id: threadIdStr,
      };
    }

    // Log the complete request body with model parameters
    console.log("=== Sending Request to Backend ===");
    console.log("Request Body:", JSON.stringify(requestBody, null, 2));
    console.log("Model Parameters:");
    console.log("- Temperature:", requestBody.temperature);
    console.log("- Top K:", requestBody.top_k);
    console.log("- Top P:", requestBody.top_p);
    console.log("- Max Tokens:", requestBody.max_tokens);
    console.log("================================");

    // Create an AbortController if not provided
    const controller = abortController || new AbortController();
    const signal = controller.signal;

    // Add abort signal to headers
    signal.addEventListener("abort", () => {
      headers["X-Abort-Requested"] = "true";
    });

    const response = await fetch(API_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
      signal, // Add the signal to the fetch request
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log("Response received. Status:", response.status);
    console.log("Response headers:", response.headers);

    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let accumulatedText = "";

    const newMessageId = uuidv4();
    setChatHistory((prevHistory) => [
      ...prevHistory,
      { id: newMessageId, sender: "assistant", text: "" },
    ]);

    let inferenceStats: InferenceStats | undefined;

    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            console.log("Stream complete");
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith("data: ")) {
              if (trimmedLine === "data: [DONE]") {
                console.log("Received [DONE] signal");
                continue;
              }

              if (trimmedLine.startsWith("data: <<END_OF_STREAM>>")) {
                console.log("End of stream marker received");
                continue;
              }

              try {
                const jsonData = JSON.parse(trimmedLine.slice(5));

                if (!isAgentSelected) {
                  // Handle statistics separately after [DONE]
                  if (jsonData.ttft && jsonData.tpot) {
                    inferenceStats = {
                      user_ttft_s: jsonData.ttft,
                      user_tpot: jsonData.tpot,
                      tokens_decoded: jsonData.tokens_decoded,
                      tokens_prefilled: jsonData.tokens_prefilled,
                      context_length: jsonData.context_length,
                    };
                    console.log("Final Inference Stats received:", inferenceStats);
                    continue; // Skip processing this chunk as part of the generated text
                  }
                }
                // Handle the generated text
                const content = jsonData.choices[0]?.delta?.content || "";
                if (content) {
                  accumulatedText += content;
                  setChatHistory((prevHistory) => {
                    const updatedHistory = [...prevHistory];
                    const lastMessage = updatedHistory[updatedHistory.length - 1];
                    if (lastMessage.id === newMessageId) {
                      lastMessage.text = accumulatedText;
                    }
                    return updatedHistory;
                  });
                }
              } catch (error) {
                console.error("Failed to parse JSON:", error);
                console.error("Problematic JSON string:", trimmedLine.slice(5));
              }
            }
          }
        }
      } catch (error: any) {
        // Check if this is an abort error
        if (error.name === "AbortError") {
          console.log("Fetch aborted by user");
          // Add a note to the message indicating it was stopped
          setChatHistory((prevHistory) => {
            const updatedHistory = [...prevHistory];
            const lastMessage = updatedHistory[updatedHistory.length - 1];
            if (lastMessage.id === newMessageId) {
              lastMessage.text = accumulatedText;
              lastMessage.isStopped = true;
            }
            return updatedHistory;
          });
        } else {
          // Re-throw other errors
          throw error;
        }
      } finally {
        reader.releaseLock();
      }
    }

    console.log("Inference stream ended.");
    setIsStreaming(false);

    if (inferenceStats) {
      console.log("Updating chat history with inference stats:", inferenceStats);
      setChatHistory((prevHistory) => {
        const updatedHistory = [...prevHistory];
        const lastMessage = updatedHistory[updatedHistory.length - 1];
        if (lastMessage.id === newMessageId) {
          lastMessage.inferenceStats = inferenceStats;
        }
        return updatedHistory;
      });
    }
  } catch (error) {
    console.error("Error running inference:", error);
    setIsStreaming(false);
  }
};

// Function to create and expose a method to stop inference
export const createInferenceController = () => {
  const controller = new AbortController();
  return {
    controller,
    stopInference: () => {
      console.log("Stopping inference...");
      controller.abort();
    },
  };
};
