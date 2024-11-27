// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useState, useEffect, useCallback } from "react";
import { Card } from "../ui/card";
import { useLocation } from "react-router-dom";
import logo from "../../assets/tt_logo.svg";
import { fetchModels } from "../../api/modelsDeployedApis";
import { useQuery } from "react-query";
import { fetchCollections } from "@/src/components/rag";
import Header from "./Header";
import ChatHistory from "./ChatHistory";
import InputArea from "./InputArea";
import { InferenceRequest, RagDataSource, ChatMessage, Model } from "./types";
import { runInference } from "./runInference";
import { v4 as uuidv4 } from "uuid";

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
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [modelsDeployed, setModelsDeployed] = useState<Model[]>([]);
  const [reRenderingMessageId, setReRenderingMessageId] = useState<
    string | null
  >(null);
  const [isListening, setIsListening] = useState<boolean>(false);

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

  const handleInference = useCallback(
    (continuationMessageId: string | null = null) => {
      if (textInput.trim() === "" || !modelID) return;

      let updatedChatHistory: ChatMessage[];

      if (continuationMessageId) {
        updatedChatHistory = chatHistory.map((msg) =>
          msg.id === continuationMessageId
            ? { ...msg, text: msg.text + " [Continuing...] " }
            : msg,
        );
      } else {
        const userMessage: ChatMessage = {
          id: uuidv4(),
          sender: "user",
          text: textInput,
        };
        updatedChatHistory = [...chatHistory, userMessage];
      }

      setChatHistory(updatedChatHistory);

      const inferenceRequest: InferenceRequest = {
        deploy_id: modelID,
        text: continuationMessageId ? `Continue: ${textInput}` : textInput,
      };

      setIsStreaming(true);

      runInference(
        inferenceRequest,
        ragDatasource,
        updatedChatHistory,
        (newHistory) => {
          setChatHistory((prevHistory) => {
            const currentHistory =
              typeof newHistory === "function"
                ? newHistory(prevHistory)
                : newHistory;
            const lastMessage = currentHistory[currentHistory.length - 1];
            if (
              lastMessage &&
              lastMessage.sender === "assistant" &&
              !lastMessage.id
            ) {
              return [
                ...currentHistory.slice(0, -1),
                { ...lastMessage, id: uuidv4() },
              ];
            }
            return currentHistory;
          });
        },
        setIsStreaming,
      );

      setTextInput("");
      setReRenderingMessageId(null);
    },
    [chatHistory, modelID, ragDatasource, textInput],
  );

  const handleReRender = useCallback(
    async (messageId: string) => {
      const messageToReRender = chatHistory.find((msg) => msg.id === messageId);
      if (
        !messageToReRender ||
        messageToReRender.sender !== "assistant" ||
        !modelID
      )
        return;

      const userMessage = chatHistory.find(
        (msg) =>
          msg.sender === "user" &&
          chatHistory.indexOf(msg) < chatHistory.indexOf(messageToReRender),
      );
      if (!userMessage) return;

      setReRenderingMessageId(messageId);
      setIsStreaming(true);

      const inferenceRequest: InferenceRequest = {
        deploy_id: modelID,
        text: userMessage.text,
      };

      await runInference(
        inferenceRequest,
        ragDatasource,
        chatHistory,
        (
          newHistory:
            | ChatMessage[]
            | ((prevHistory: ChatMessage[]) => ChatMessage[]),
        ) => {
          setChatHistory((prevHistory) => {
            const currentHistory = Array.isArray(newHistory)
              ? newHistory
              : newHistory(prevHistory);
            return prevHistory.map((msg) => {
              if (msg.id === messageId) {
                const updatedMessage =
                  currentHistory[currentHistory.length - 1];
                return {
                  ...msg,
                  text: updatedMessage.text,
                  inferenceStats: updatedMessage.inferenceStats,
                };
              }
              return msg;
            });
          });
        },
        setIsStreaming,
      );

      setReRenderingMessageId(null);
    },
    [chatHistory, modelID, ragDatasource],
  );

  const handleContinue = useCallback(
    (messageId: string) => {
      const messageToContinue = chatHistory.find((msg) => msg.id === messageId);
      if (!messageToContinue || messageToContinue.sender !== "assistant")
        return;

      setTextInput(`Continue from: "${messageToContinue.text}"`);
    },
    [chatHistory],
  );

  return (
    <div className="flex flex-col w-10/12 mx-auto h-screen overflow-hidden p-2">
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
          isStreaming={isStreaming}
          onReRender={handleReRender}
          onContinue={handleContinue}
          reRenderingMessageId={reRenderingMessageId}
        />
        <InputArea
          textInput={textInput}
          setTextInput={setTextInput}
          handleInference={() => handleInference(null)}
          isStreaming={isStreaming}
          isListening={isListening}
          setIsListening={setIsListening}
        />
      </Card>
    </div>
  );
}
