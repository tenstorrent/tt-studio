// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useEffect, useState, useRef } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { useLocation } from "react-router-dom";
import { Spinner } from "./ui/spinner";
import { User, ChevronDown } from "lucide-react";
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
import { fetchCollections } from "@/src/pages/rag/";

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
}

interface Model {
  id: string;
  name: string;
}

const ChatComponent: React.FC = () => {
  const location = useLocation();
  const [textInput, setTextInput] = useState<string>("");

  const [ragDatasource, setRagDatasource] = useState<
    RagDataSource | undefined
  >();

  // Fetch collections
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
      const isAtBottom =
        viewportRef.current.scrollHeight - viewportRef.current.scrollTop <=
        viewportRef.current.clientHeight + 1;
      setIsScrollButtonVisible(!isAtBottom);
    }
  };

  const getRagContext = async (request: InferenceRequest) => {
    const ragContext: { documents: string[] } = {
      documents: [],
    };

    const response = await axios
      .get(`/collections-api/${ragDatasource?.name}/query`, {
        params: { query: request.text },
      })
      .catch((e) => {
        console.error(`Error fetching RAG context ${e}`);
      });

    if (!response?.data) {
      return ragContext;
    }

    ragContext.documents = response.data.documents;
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      const reader = response.body?.getReader();

      setChatHistory((prevHistory) => [
        ...prevHistory,
        { sender: "user", text: textInput },
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
            result += chunk;
            const cleanedResult = result.replace(/<\|endoftext\|>/g, "");
            setChatHistory((prevHistory) => {
              const lastMessage = prevHistory[prevHistory.length - 1];
              if (lastMessage && lastMessage.sender === "assistant") {
                const updatedHistory = [...prevHistory];
                updatedHistory[updatedHistory.length - 1] = {
                  ...lastMessage,
                  text: cleanedResult,
                };
                return updatedHistory;
              } else {
                return [
                  ...prevHistory,
                  { sender: "assistant", text: cleanedResult },
                ];
              }
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
    if (textInput.trim() === "") return;

    const inferenceRequest: InferenceRequest = {
      deploy_id: modelID!,
      text: textInput,
    };

    if (textInput === "Tell me a fun fact.") {
      setChatHistory((prevHistory) => [
        ...prevHistory,
        { sender: "user", text: textInput },
        { sender: "assistant", text: "Did you know? Honey never spoils." },
      ]);
      setTextInput("");
      scrollToBottom();
      return;
    }

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
    <div className="flex justify-start items-center my-2 align-center text-center">
      <div className="text-sm align-center mr-4"> Select RAG Datasource </div>

      <Select onValueChange={onChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue
            placeholder={activeCollection?.name ?? "Select Rag Datasource"}
          />
        </SelectTrigger>
        <SelectContent>
          {collections.map((c) => {
            return (
              <SelectItem key={c.id} value={c.name}>
                {c.name}
              </SelectItem>
            );
          })}
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

  return (
    <div className="flex flex-col overflow-auto w-10/12 mx-auto">
      <Card className="flex flex-col w-full h-full">
        <div className="bg-gray-200 dark:bg-gray-800 rounded-lg p-6 shadow-lg dark:shadow-2xl">
          <Breadcrumb className="flex items-center">
            <BreadcrumbList className="flex gap-4 text-lg">
              <BreadcrumbItem>
                <BreadcrumbLink
                  href="/models-deployed"
                  className="text-gray-600 dark:text-gray-200 hover:text-gray-800 dark:hover:text-white transition-colors duration-300"
                >
                  Models Deployed
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="mx-4 text-gray-400">
                /
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center gap-1 focus:outline-none">
                    <BreadcrumbEllipsis className="h-5 w-5 text-gray-600 dark:text-blue-400" />
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
              </BreadcrumbItem>
              <BreadcrumbSeparator className="mx-4 text-gray-400">
                /
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                <BreadcrumbPage className="text-gray-800 dark:text-blue-400 font-bold hover:text-gray-900 dark:hover:text-white transition-colors duration-300">
                  {modelName}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex flex-col w-full h-full p-8 font-rmMono">
          <RagContextSelector                                                                                                                                                                  
            collections={ragDataSources}                                                                                                                                                       
            onChange={(v: string) => {                                                                                                                                                         
              const dataSource = ragDataSources.find((rds: RagDataSource) => {                                                                                                                 
                return rds.name == v;                                                                                                                                                          
              });                                                                                                                                                                              
              if (dataSource) {                                                                                                                                                                
                setRagDatasource(dataSource);                                                                                                                                                  
              }                                                                                                                                                                                
            }}                                                                                                                                                                                 
            activeCollection={ragDatasource}                                                                                                                                                   
          />   
          {chatHistory.length === 0 && (
            <ChatExamples logo={logo} setTextInput={setTextInput} />
          )}
          {chatHistory.length > 0 && (
            <div className="relative flex flex-col h-full">
              <ScrollArea.Root>
                <ScrollArea.Viewport
                  ref={viewportRef}
                  onScroll={handleScroll}
                  className="h-[calc(100vh-20rem)] overflow-auto p-4 border rounded-lg"
                >
                  {chatHistory.map((message, index) => (
                    <div
                      key={index}
                      className={`chat ${
                        message.sender === "user" ? "chat-end" : "chat-start"
                      }`}
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
                        }`}
                      >
                        {message.text}
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </ScrollArea.Viewport>
                <ScrollArea.Scrollbar orientation="vertical">
                  <ScrollArea.Thumb />
                </ScrollArea.Scrollbar>
              </ScrollArea.Root>
              {isScrollButtonVisible && (
                <Button
                  className="fixed bottom-4 left-1/2 transform -translate-x-1/2 p-2 rounded-full bg-gray-700 text-white"
                  onClick={scrollToBottom}
                >
                  <ChevronDown className="h-6 w-6" />
                </Button>
              )}
            </div>
          )}
          <div className="flex items-center pt-4 relative">
            <Textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Enter text for inference"
              className="px-4 py-2 border rounded-lg shadow-md w-full pr-24 box-border font-rmMono"
              disabled={isStreaming}
              rows={4}
            />
            <div
              className="absolute right-3 top-1/2 transform -translate-y-1/2 cursor-pointer"
              onClick={handleInference}
            >
              <kbd
                className="kbd kbd-lg bg-gray-800 dark:bg-gray-700 text-white dark:text-gray-300 border border-gray-600 rounded-lg flex items-center justify-center"
                style={{ padding: "0.5rem 0.75rem", minWidth: "4rem" }}
              >
                <div className="flex items-center justify-center space-x-2">
                  {isStreaming ? (
                    <Spinner />
                  ) : (
                    <div className="flex items-center space-x-1">
                      <ChevronDown className="h-5 w-5 text-gray-300" />
                      <span className="text-sm">Enter</span>
                    </div>
                  )}
                </div>
              </kbd>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ChatComponent;
