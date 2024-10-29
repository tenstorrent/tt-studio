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
    const response = await fetch(`/models-api/inference/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
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
          const decoder = new TextDecoder();
          const chunk = decoder.decode(value);
          console.log("Chunk:", chunk);
          result += chunk;
          const endOfStreamIndex = result.indexOf("<<END_OF_STREAM>>");
          if (endOfStreamIndex !== -1) {
            result = result.substring(0, endOfStreamIndex);
            done = true;
          }
          const cleanedResult = result
            .replace(/<\|eot_id\|>/g, "")
            .replace(/<\|endoftext\|>/g, "")
            .trim();
          const statsStartIndex = cleanedResult.indexOf("{");
          const statsEndIndex = cleanedResult.lastIndexOf("}");

          let chatContent = cleanedResult;

          if (statsStartIndex !== -1 && statsEndIndex !== -1) {
            chatContent = cleanedResult.substring(0, statsStartIndex).trim();

            const statsJson = cleanedResult.substring(
              statsStartIndex,
              statsEndIndex + 1,
            );
            try {
              const parsedStats = JSON.parse(statsJson);
              setChatHistory((prevHistory) => {
                const updatedHistory = [...prevHistory];
                const lastAssistantMessage = updatedHistory.findLastIndex(
                  (message) => message.sender === "assistant",
                );
                if (lastAssistantMessage !== -1) {
                  updatedHistory[lastAssistantMessage] = {
                    ...updatedHistory[lastAssistantMessage],
                    inferenceStats: parsedStats,
                  };
                }
                return updatedHistory;
              });
            } catch (e) {
              console.error("Error parsing inference stats:", e);
            }
          }

          setChatHistory((prevHistory) => {
            const updatedHistory = [...prevHistory];
            updatedHistory[updatedHistory.length - 1] = {
              ...updatedHistory[updatedHistory.length - 1],
              text: chatContent,
            };
            return updatedHistory;
          });
        }
      }
    }

    setIsStreaming(false);
  } catch (error) {
    console.error("Error running inference:", error);
    setIsStreaming(false);
  }
};
