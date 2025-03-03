// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
  InferenceRequest,
  RagDataSource,
  ChatMessage,
  InferenceStats,
} from "./types";
import { getRagContext } from "./getRagContext";
import { generatePrompt } from "./templateRenderer";
import { v4 as uuidv4 } from "uuid";

export const runInference = async (
  request: InferenceRequest,
  ragDatasource: RagDataSource | undefined,
  chatHistory: ChatMessage[],
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
  isAgentSelected: boolean,
  threadId: number 
) => {
  try {
    setIsStreaming(true);

    let ragContext: { documents: string[] } | null = null;

    if (ragDatasource) {
      console.log("Fetching RAG context for the given request...");
      ragContext = await getRagContext(request, ragDatasource);
      console.log("RAG context fetched:", ragContext);
    }

    console.log("RAG context being passed to generatePrompt:", ragContext);
    const messages = generatePrompt(
      chatHistory.map((msg) => ({ sender: msg.sender, text: msg.text })),
      ragContext,
    );

    console.log("Generated messages:", messages);
    console.log("Thread ID: ", threadId); 

    const API_URL = isAgentSelected 
    ? import.meta.env.VITE_SPECIAL_API_URL || "/models-api/agent/"  
    : import.meta.env.VITE_API_URL || "/models-api/inference/"; 
    
    const AUTH_TOKEN = import.meta.env.VITE_AUTH_TOKEN || "";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (AUTH_TOKEN) {
      headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
    }

    let requestBody; 
    let threadIdStr = threadId.toString(); 

    if (!isAgentSelected) {
      requestBody = {
        deploy_id: request.deploy_id,
        // model: "meta-llama/Llama-3.1-70B-Instruct",
        messages: messages,
        max_tokens: 512,
        stream: true,
        stream_options: {
          include_usage: true,
        },
      };
    }
    else {
      requestBody = {
        deploy_id: request.deploy_id,
        // model: "meta-llama/Llama-3.1-70B-Instruct",
        messages: messages,
        max_tokens: 512,
        stream: true,
        stream_options: {
          include_usage: true,
        },
        thread_id: threadIdStr, // Add thread_id to the request body
      };
    }
 
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
    let accumulatedText = "";

    const newMessageId = uuidv4();
    setChatHistory((prevHistory) => [
      ...prevHistory,
      { id: newMessageId, sender: "assistant", text: "" },
    ]);

    let inferenceStats: InferenceStats | undefined;

    if (reader) {
      // eslint-disable-next-line no-constant-condition
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
              // // Handle statistics separately after [DONE]
              if (jsonData.ttft && jsonData.tpot) {
                inferenceStats = {
                  user_ttft_s: jsonData.ttft,
                  user_tpot: jsonData.tpot,
                  tokens_decoded: jsonData.tokens_decoded,
                  tokens_prefilled: jsonData.tokens_prefilled,
                  context_length: jsonData.context_length
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
    }

    console.log("Inference stream ended.");
    setIsStreaming(false);

    // Update chat history with inference stats after streaming is fully completed
    if (inferenceStats) {
      console.log(
        "Updating chat history with inference stats:",
        inferenceStats,
      );
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
