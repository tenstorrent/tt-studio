// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import React, { useState, useEffect, useRef } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { useLocation } from "react-router-dom";
import { Spinner } from "./ui/spinner";
import { User, ChevronDown, Send } from "lucide-react";
import { Textarea } from "./ui/textarea";
import logo from "../assets/tt_logo.svg";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { fetchModels } from "../api/modelsDeployedApis";
import ChatExamples from "./ChatExamples";
import axios from "axios";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useQuery } from "react-query";
import { fetchCollections } from "@/src/components/rag";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import InferenceStats from "./InferenceStats";
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
  inferenceStats?: InferenceStats; // Optional property for stats
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
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

  const scrollToBottom = () => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  const handleScroll = () => {
    if (viewportRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
      const isAtBottom = scrollHeight - scrollTop <= clientHeight + 1;
      setIsScrollButtonVisible(!isAtBottom);
    }
  };

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
              .replace(/<\|eot_id\|>/g, "") // Remove "<|eot_id|>"
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

  const RagContextSelector = ({
    collections,
    onChange,
    activeCollection,
  }: {
    collections: RagDataSource[];
    activeCollection?: RagDataSource;
    onChange: (v: string) => void;
  }) => (
    <div className="flex items-center">
      <Select onValueChange={onChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue
            placeholder={activeCollection?.name ?? "Select RAG Datasource"}
          />
        </SelectTrigger>
        <SelectContent>
          {collections.map((c) => (
            <SelectItem key={c.id} value={c.name}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleInference();
    }
  };

  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
    setTextInput(e.target.value);
  };

  return (
    <div className="flex flex-col w-10/12 mx-auto h-screen overflow-hidden">
      <Card className="flex flex-col w-full h-full">
        <div className="bg-gray-200 dark:bg-gray-800 rounded-lg p-4 pshadow-lg dark:shadow-2xl sticky top-2 z-10 flex justify-between items-center">
          {/* Breadcrumbs and RAG context selector */}
          <Breadcrumb className="flex items-center">
            <BreadcrumbList className="flex gap-2 text-sm">
              <BreadcrumbItem>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <BreadcrumbLink
                        href="/models-deployed"
                        className="text-gray-600 dark:text-gray-200 hover:text-gray-800 dark:hover:text-white transition-colors duration-300 flex items-center"
                      >
                        Models Deployed
                      </BreadcrumbLink>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>View all deployed models</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="mx-2 text-gray-400">
                /
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="flex items-center gap-1 focus:outline-none">
                          <BreadcrumbEllipsis className="h-4 w-4 text-gray-600 " />
                          <span className="sr-only">Toggle menu</span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {modelsDeployed.map((model) => (
                            <DropdownMenuItem
                              key={model.id}
                              onClick={() => {
                                setModelID(model.id);
                                setModelName(model.name);
                              }}
                            >
                              {model.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Select a different model</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="mx-2 text-gray-400">
                /
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <BreadcrumbPage className="text-gray-800 dark:text-blue-400 font-bold hover:text-gray-900 dark:hover:text-white transition-colors duration-300">
                        {modelName}
                      </BreadcrumbPage>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Current selected model</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <RagContextSelector
            collections={ragDataSources}
            onChange={(v: string) => {
              const dataSource = ragDataSources.find(
                (rds: RagDataSource) => rds.name === v,
              );
              if (dataSource) {
                setRagDatasource(dataSource);
              }
            }}
            activeCollection={ragDatasource}
          />
        </div>
        {/* Chat history section */}
        <div className="flex flex-col w-full flex-grow p-8 font-rmMono relative overflow-hidden">
          {chatHistory.length === 0 && (
            <ChatExamples logo={logo} setTextInput={setTextInput} />
          )}
          {chatHistory.length > 0 && (
            <ScrollArea.Root className="flex-grow h-0 overflow-y-auto">
              <ScrollArea.Viewport
                ref={viewportRef}
                onScroll={handleScroll}
                className="w-full pr-4"
              >
                <div className="p-4 border rounded-lg">
                  {chatHistory.map((message, index) => (
                    <div
                      key={index}
                      className={`chat ${message.sender === "user" ? "chat-end" : "chat-start"}`}
                    >
                      <div className="chat-image avatar text-left">
                        <div className="w-10 rounded-full">
                          {message.sender === "user" ? (
                            <User className="h-6 w-6 mr-2 text-left" />
                          ) : (
                            <img
                              src={logo}
                              alt="Tenstorrent Logo"
                              className="w-8 h-8 rounded-full mr-2"
                            />
                          )}
                        </div>
                      </div>
                      <div
                        className={`chat-bubble ${
                          message.sender === "user"
                            ? "bg-TT-green-accent text-white text-left"
                            : "bg-TT-slate text-white text-left"
                        } p-3 rounded-lg mb-1`}
                        style={{ wordBreak: "break-word" }}
                      >
                        {message.text}
                      </div>
                      {message.sender === "assistant" &&
                        message.inferenceStats && (
                          <InferenceStats stats={message.inferenceStats} />
                        )}
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea.Viewport>
            </ScrollArea.Root>
          )}

          <div
            className={`absolute bottom-4 right-4 transition-all duration-300 ease-in-out ${
              isScrollButtonVisible
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-4"
            }`}
          >
            <Button
              className="rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300"
              onClick={scrollToBottom}
            >
              <ChevronDown className="h-6 w-6 animate-bounce" />
            </Button>
          </div>
        </div>

        <div className="flex-shrink-0 p-4 ">
          <div className="relative w-full">
            <Textarea
              value={textInput}
              onInput={handleTextAreaInput}
              onKeyDown={handleKeyPress}
              placeholder="Enter text for inference"
              className="px-4 py-2 pr-16 border rounded-lg shadow-md w-full box-border font-rmMono"
              disabled={isStreaming}
              rows={1}
              style={{
                resize: "none",
                maxHeight: "150px",
                overflowY: "auto",
              }}
            />
            <Button
              className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300"
              onClick={handleInference}
              disabled={isStreaming || !textInput.trim()}
            >
              {isStreaming ? <Spinner /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
