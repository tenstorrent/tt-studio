// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useState, useEffect } from "react";
import { Card } from "../ui/card";
import { useLocation } from "react-router-dom";
import logo from "../../assets/tt_logo.svg";
import { fetchModels } from "../../api/modelsDeployedApis";
import axios from "axios";
import { useQuery } from "react-query";
import { fetchCollections } from "@/src/components/rag";
import Header from "./Header";
import ChatHistory from "./ChatHistory";
import InputArea from "./InputArea";

interface InferenceRequest {
  deploy_id: string;
  text: string;
  rag_context?: { documents: string[] };
}

interface RagDataSource {
  id: string;
  name: string;
  metadata: Record<string, string>;
}

interface ChatMessage {
  sender: "user" | "assistant";
  text: string;
  inferenceStats?: InferenceStats;
}

interface Model {
  id: string;
  name: string;
}

interface InferenceStats {
  user_ttft_ms: number;
  user_tps: number;
  user_ttft_e2e_ms: number;
  prefill: {
    tokens_prefilled: number;
    tps: number;
  };
  decode: {
    tokens_decoded: number;
    tps: number;
  };
  batch_size: number;
  context_length: number;
}

export default function ChatComponent() {
  const location = useLocation();
  const [textInput, setTextInput] = useState<string>("");
  const [ragDatasource, setRagDatasource] = useState<
    RagDataSource | undefined
  >();
  const { data: ragDataSources } = useQuery("collectionsList", {
    queryFn: fetchCollections,
    initialData: [],
  });
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [modelID, setModelID] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [modelsDeployed, setModelsDeployed] = useState<Model[]>([]);

  useEffect(() => {
    if (location.state) {
      setModelID(location.state.containerID);
      setModelName(location.state.modelName);
    }

    const loadModels = async () => {
      try {
        const models = await fetchModels();
        setModelsDeployed(models);
      } catch (error) {
        console.error("Error fetching models:", error);
      }
    };

    loadModels();
  }, [location.state]);

  const getRagContext = async (request: InferenceRequest) => {
    const ragContext: { documents: string[] } = { documents: [] };

    if (!ragDatasource) return ragContext;

    try {
      const response = await axios.get(
        `/collections-api/${ragDatasource.name}/query`,
        {
          params: { query: request.text },
        },
      );
      if (response?.data) {
        ragContext.documents = response.data.documents;
      }
    } catch (e) {
      console.error(`Error fetching RAG context: ${e}`);
    }

    return ragContext;
  };

  const runInference = async (request: InferenceRequest) => {
    try {
      if (ragDatasource) {
        request.rag_context = await getRagContext(request);
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
      setTextInput("");

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

  const handleInference = () => {
    if (textInput.trim() === "" || !modelID) return;

    const inferenceRequest: InferenceRequest = {
      deploy_id: modelID,
      text: textInput,
    };

    runInference(inferenceRequest);
  };

  return (
    <div className="flex flex-col w-10/12 mx-auto h-screen overflow-hidden">
      <Card className="flex flex-col w-full h-full">
        <Header
          modelName={modelName}
          modelsDeployed={modelsDeployed}
          setModelID={setModelID}
          setModelName={setModelName}
          ragDataSources={ragDataSources}
          ragDatasource={ragDatasource}
          setRagDatasource={setRagDatasource}
        />
        <ChatHistory
          chatHistory={chatHistory}
          logo={logo}
          setTextInput={setTextInput}
        />
        <InputArea
          textInput={textInput}
          setTextInput={setTextInput}
          handleInference={handleInference}
          isStreaming={isStreaming}
        />
      </Card>
    </div>
  );
}
