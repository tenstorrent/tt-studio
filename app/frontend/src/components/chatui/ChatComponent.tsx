// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useState, useEffect } from "react";
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

  const handleInference = async (
    input: string,
    continuationMessageId: string | null = null,
  ) => {
    if (input.trim() === "" || !modelID) return;

    let updatedChatHistory: ChatMessage[];

    if (continuationMessageId) {
      // If continuing, find the message to continue and update it
      updatedChatHistory = chatHistory.map((msg) =>
        msg.id === continuationMessageId
          ? { ...msg, text: msg.text + " [Continuing...] " }
          : msg,
      );
    } else {
      // If not continuing, add a new user message
      const userMessage: ChatMessage = {
        id: uuidv4(),
        sender: "user",
        text: input,
      };
      updatedChatHistory = [...chatHistory, userMessage];
    }

    setChatHistory(updatedChatHistory);

    const inferenceRequest: InferenceRequest = {
      deploy_id: modelID,
      text: continuationMessageId ? `Continue: ${input}` : input,
    };

    setIsStreaming(true);

    // Run inference
    await runInference(
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
  };

  const handleReRender = async (messageId: string) => {
    const messageToReRender = chatHistory.find((msg) => msg.id === messageId);
    if (!messageToReRender || messageToReRender.sender !== "assistant") return;

    const userMessage = chatHistory.find(
      (msg) =>
        msg.sender === "user" &&
        chatHistory.indexOf(msg) < chatHistory.indexOf(messageToReRender),
    );
    if (!userMessage) return;

    setReRenderingMessageId(messageId);
    await handleInference(userMessage.text);
  };

  const handleContinue = async (messageId: string) => {
    const messageToContinue = chatHistory.find((msg) => msg.id === messageId);
    if (!messageToContinue || messageToContinue.sender !== "assistant") return;

    setTextInput(`Continue from: "${messageToContinue.text}"`);
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
          isStreaming={isStreaming}
          onReRender={handleReRender}
          onContinue={handleContinue}
          reRenderingMessageId={reRenderingMessageId}
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
