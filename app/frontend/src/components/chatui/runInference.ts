// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import type React from "react";
import type {
  InferenceRequest,
  RagDataSource,
  ChatMessage,
  InferenceStats,
  TimingInfo,
} from "./types";
import { getRagContext } from "./getRagContext";
import { generatePrompt } from "./templateRenderer";
import { v4 as uuidv4 } from "uuid";
import { processUploadedFiles } from "./processUploadedFiles";
import { InferenceMetricsTracker } from "./metricsTracker";

export const runInference = async (
  request: InferenceRequest,
  ragDatasource: RagDataSource | undefined,
  chatHistory: ChatMessage[],
  setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
  isAgentSelected: boolean,
  threadId: number,
  abortController?: AbortController,
  systemPrompt: string | null = null,
) => {
  console.log("[TRACE_FLOW_STEP_1_FRONTEND_ENTRY] runInference called", {
    request,
    isAgentSelected,
    threadId,
  });
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
          ragContext.documents = [
            ...ragContext.documents,
            ...fileRagContext.documents,
          ];
        } else {
          ragContext = fileRagContext;
        }

        // Process with RAG context
        console.log("Processing with combined RAG context:", ragContext);
        messages = generatePrompt(
          chatHistory.map((msg) => ({ sender: msg.sender, text: msg.text })),
          ragContext,
          systemPrompt,
        );
      } else if (file.image_url?.url || file) {
        console.log(
          "Image file detected, using image_url message structure",
          file.image_url?.url
        );
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
        ragContext,
        systemPrompt,
      );
    }

    console.log("Generated messages:", messages);
    console.log("Thread ID: ", threadId);
    console.log("=== AGENT SELECTION DEBUG ===");
    console.log("isAgentSelected:", isAgentSelected);
    console.log("typeof isAgentSelected:", typeof isAgentSelected);

    const apiUrlDefined = import.meta.env.VITE_ENABLE_DEPLOYED === "true";
    console.log("apiUrlDefined:", apiUrlDefined);
    console.log(
      "import.meta.env.VITE_ENABLE_DEPLOYED:",
      import.meta.env.VITE_ENABLE_DEPLOYED
    );
    console.log(
      "import.meta.env.VITE_SPECIAL_API_URL:",
      import.meta.env.VITE_SPECIAL_API_URL
    );
    console.log(
      "import.meta.env.VITE_LLAMA_AUTH_TOKEN:",
      import.meta.env.VITE_LLAMA_AUTH_TOKEN
    );
    console.log("isAgentSelected:", isAgentSelected);
    console.log(
      "import.meta.env.VITE_SPECIAL_API_URL || '/models-api/agent/'",
      import.meta.env.VITE_SPECIAL_API_URL || "/models-api/agent/"
    );
    console.log(
      "apiUrlDefined ? '/models-api/inference_cloud/' : '/models-api/inference/'",
      apiUrlDefined ? "/models-api/inference_cloud/" : "/models-api/inference/"
    );
    const API_URL = isAgentSelected
      ? import.meta.env.VITE_SPECIAL_API_URL || "/models-api/agent/"
      : apiUrlDefined
        ? "/models-api/inference_cloud/"
        : "/models-api/inference/";

    console.log("API URL:", API_URL);
    console.log("=============================");

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
      console.log("Using normal LLM flow (not agent)");
      requestBody = {
        ...(apiUrlDefined ? {} : { deploy_id: request.deploy_id }),
        ...(apiUrlDefined
          ? { model: "meta-llama/Llama-3.3-70B-Instruct" }
          : {}),
        messages: messages,
        temperature: request.temperature,
        top_k: request.top_k,
        top_p: request.top_p,
        max_tokens: request.max_tokens,
        ...(request.seed && request.seed > 0 ? { seed: request.seed } : {}),
        stream: true,
        stream_options: {
          include_usage: true,
          continuous_usage_stats: true,
        },
      };
    } else {
      console.log("Using agent flow");
      requestBody = {
        deploy_id: request.deploy_id,
        messages: messages,
        temperature: request.temperature,
        top_k: request.top_k,
        top_p: request.top_p,
        max_tokens: request.max_tokens,
        ...(request.seed && request.seed > 0 ? { seed: request.seed } : {}),
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

    // --- Timing instrumentation (mirrors tt-cloud-console streamChatCompletion) ---
    const t: Record<string, number> = { start: performance.now() };

    // Initialize metrics tracker for this inference request
    const metricsTracker = new InferenceMetricsTracker();

    const response = await fetch(API_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
      signal,
    });
    t.httpResponse = performance.now();

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 422 && body.includes('"content"') && body.includes("string")) {
        throw new Error("This model does not support image inputs. Try a vision-capable model, or send text only.");
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    // Separate accumulators for content and thinking
    let contentText = "";
    let thinkingText = "";
    let thinkingDone = false;
    // Combined text fed to StreamingMessage — wraps thinking in <think>...</think>
    let accumulatedText = "";

    const newMessageId = uuidv4();
    setChatHistory((prevHistory) => [
      ...prevHistory,
      { id: newMessageId, sender: "assistant", text: "" },
    ]);

    let inferenceStats: InferenceStats | undefined;
    let rafScheduled = false;
    let finishReason: string | null = null;
    let sseEventCount = 0;

    const scheduleUiUpdate = () => {
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(() => {
          // Read current value at callback time — avoids stale snapshot bug
          const currentText = accumulatedText;
          setChatHistory((prevHistory) => {
            const updatedHistory = [...prevHistory];
            const lastMessage = updatedHistory[updatedHistory.length - 1];
            if (lastMessage?.id === newMessageId) {
              lastMessage.text = currentText;
            }
            return updatedHistory;
          });
          rafScheduled = false;
        });
      }
    };

    try {
      while (true) {
        let done: boolean;
        let value: Uint8Array | undefined;
        try {
          ({ done, value } = await reader.read());
        } catch {
          // Connection closed after [DONE] — treat as normal end-of-stream
          break;
        }
        if (done) break;

        if (!t.firstRead) t.firstRead = performance.now();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          let jsonData: any;
          try {
            jsonData = JSON.parse(data);
          } catch {
            // Skip malformed chunks silently
            continue;
          }

          sseEventCount++;
          if (!t.firstSSE) t.firstSSE = performance.now();

          // Backend custom stats chunk (sent after [DONE] by stream_response_from_external_api)
          if (!isAgentSelected && jsonData.tokens_decoded !== undefined) {
            const backendStats: InferenceStats = {
              user_ttft_s: jsonData.ttft,
              user_tpot: jsonData.tpot,
              itl: Array.isArray(jsonData.itl) ? jsonData.itl.map((s: number) => s * 1000) : undefined,
              tokens_decoded: jsonData.tokens_decoded,
              tokens_prefilled: jsonData.tokens_prefilled,
              context_length: jsonData.context_length,
              reasoning_tokens: jsonData.reasoning_tokens ?? undefined,
              thinking_duration_ms: jsonData.thinking_duration != null ? jsonData.thinking_duration * 1000 : undefined,
            };
            inferenceStats = metricsTracker.finalizeStats(backendStats);
            continue;
          }

          // Track usage data from streaming chunks
          const usage = jsonData.usage;
          if (usage?.completion_tokens) {
            metricsTracker.recordUsage(usage);
          }

          const fr = jsonData.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;

          const delta = jsonData.choices?.[0]?.delta;

          // Thinking/reasoning tokens (multi-vendor field names)
          const rawReasoning = delta?.reasoning_content ?? delta?.reasoning ?? delta?.thinking;
          const reasoning =
            typeof rawReasoning === "string"
              ? rawReasoning.replace(/<\/?think>/gi, "")
              : null;

          if (reasoning && !thinkingDone) {
            if (!t.firstToken) t.firstToken = performance.now();
            metricsTracker.recordThinkingToken();
            thinkingText += reasoning;
            // Incomplete thinking block — no closing tag yet so StreamingMessage shows "Thinking..."
            accumulatedText = `<think>${thinkingText}${contentText}`;
            scheduleUiUpdate();
          }

          // Regular content tokens
          const content = delta?.content ?? jsonData.choices?.[0]?.text ?? "";
          if (content) {
            if (thinkingText && !thinkingDone) {
              thinkingDone = true; // close thinking block once content starts arriving
            }
            if (!t.firstToken) t.firstToken = performance.now();
            metricsTracker.recordContentToken();
            contentText += content;
            accumulatedText = thinkingText
              ? `<think>${thinkingText}</think>${contentText}`
              : contentText;
            scheduleUiUpdate();
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        setChatHistory((prevHistory: ChatMessage[]) => {
          const updatedHistory = [...prevHistory];
          const lastMessage = updatedHistory[updatedHistory.length - 1];
          if (lastMessage?.id === newMessageId) {
            lastMessage.text = accumulatedText;
            lastMessage.isStopped = true;
          }
          return updatedHistory;
        });
      } else {
        throw error;
      }
    } finally {
      reader.releaseLock();
    }

    t.end = performance.now();
    const ms = (key: string) => (t[key] != null ? `${Math.round(t[key] - t.start)}ms` : "—");
    const serverTtftMs = inferenceStats?.user_ttft_s != null
      ? Math.round(inferenceStats.user_ttft_s * 1000)
      : null;
    const clientTtftMs = t.firstToken != null ? Math.round(t.firstToken - t.start) : null;
    const overhead = clientTtftMs != null && serverTtftMs != null
      ? clientTtftMs - serverTtftMs
      : null;
    console.log(
      `[Stream timing] clientTTFT=${ms("firstToken")} serverTTFT=${serverTtftMs != null ? serverTtftMs + "ms" : "—"} overhead=${overhead != null ? overhead + "ms" : "—"}\n` +
      `  HTTP: ${ms("httpResponse")} | FirstRead: ${ms("firstRead")} | FirstSSE: ${ms("firstSSE")} | FirstToken: ${ms("firstToken")} | Total: ${ms("end")} | SSE events: ${sseEventCount} | finish_reason: ${finishReason ?? "—"}`
    );
    if (finishReason === "length") {
      console.warn("⚠️ Response truncated: hit max_tokens limit");
    }

    const timing: TimingInfo = {
      httpResponse: Math.round(t.httpResponse - t.start),
      firstRead: t.firstRead != null ? Math.round(t.firstRead - t.start) : null,
      firstSSE: t.firstSSE != null ? Math.round(t.firstSSE - t.start) : null,
      firstToken: clientTtftMs,
      total: Math.round(t.end - t.start),
      hasServerTtft: serverTtftMs != null,
      hasServerTps: inferenceStats?.user_tpot != null,
    };

    // Client-side TPS fallback (when backend doesn't report tpot)
    if (!inferenceStats?.tps && t.firstToken != null) {
      const lastTimestamp = metricsTracker.getTokenTimestamps().at(-1);
      if (lastTimestamp && lastTimestamp.count > 0) {
        const genSeconds = (t.end - t.firstToken) / 1000;
        if (genSeconds > 0) {
          if (!inferenceStats) inferenceStats = {};
          inferenceStats.tps = lastTimestamp.count / genSeconds;
        }
      }
    }

    if (inferenceStats) {
      inferenceStats.timing = timing;
    }

    setIsStreaming(false);

    if (inferenceStats) {
      setChatHistory((prevHistory) => {
        const updatedHistory = [...prevHistory];
        const lastMessage = updatedHistory[updatedHistory.length - 1];
        if (lastMessage?.id === newMessageId) {
          lastMessage.inferenceStats = inferenceStats;
          lastMessage.finishReason = finishReason;
          lastMessage.timing = timing;
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
