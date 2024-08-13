import React, { useEffect, useState, useRef } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { useLocation } from "react-router-dom";
import { Spinner } from "./ui/spinner";
import { useTheme } from "../providers/ThemeProvider";
import {
  Smile,
  Sun,
  User,
  Angry,
  DollarSign,
  CircleArrowUp,
  ChevronDown,
} from "lucide-react";
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

interface InferenceRequest {
  deploy_id: string;
  text: string;
}

interface ChatMessage {
  sender: "user" | "assistant";
  text: string;
}

const modelAPIURL = "/models-api/";
const inferenceUrl = `${modelAPIURL}/inference/`;

const ChatComponent: React.FC = () => {
  const { theme } = useTheme();
  const location = useLocation();
  const [textInput, setTextInput] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [modelID, setModelID] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);

  useEffect(() => {
    if (location.state) {
      setModelID(location.state.containerID);
      setModelName(location.state.modelName);
    }
  }, [location.state]);

  console.log("Model ID:", modelID, "Model Name:", modelName);

  const scrollToBottom = () => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatHistory]);

  const handleScroll = () => {
    if (scrollAreaRef.current) {
      const isAtBottom =
        scrollAreaRef.current.scrollHeight - scrollAreaRef.current.scrollTop <=
        scrollAreaRef.current.clientHeight + 1;
      setIsScrollButtonVisible(!isAtBottom);
    }
  };

  const runInference = async (request: InferenceRequest) => {
    try {
      setIsStreaming(true);
      const response = await fetch(inferenceUrl, {
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
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

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
          scrollToBottom();
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

    if (textInput === "When will Tenstorrent out sell Nvidia?") {
      setChatHistory((prevHistory) => [
        ...prevHistory,
        { sender: "user", text: textInput },
        { sender: "assistant", text: "2024, that was a silly question." },
      ]);
      setTextInput("");
      scrollToBottom();
      return;
    }

    runInference(inferenceRequest);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleInference();
    }
  };

  return (
    <div className="flex flex-col overflow-auto w-10/12 mx-auto">
      <Card className="flex flex-col w-full h-full">
        <Breadcrumb className="border-b-2 border-gray-200 dark:border-gray-700 mb-4 bg-white dark:bg-gray-900 rounded-t-2xl shadow-lg dark:shadow-2xl p-6 text-xl text-black dark:text-white">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink
                href="/models-deployed"
                className="text-black dark:text-white hover:text-blue-500 dark:hover:text-blue-400"
              >
                Models Deployed
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-1">
                  <BreadcrumbEllipsis className="h-4 w-4" />
                  <span className="sr-only">Toggle menu</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem>Model 1</DropdownMenuItem>
                  <DropdownMenuItem>Model 2</DropdownMenuItem>
                  <DropdownMenuItem>Model 3</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{modelName}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-col w-full h-full p-8">
          {chatHistory.length === 0 && (
            <div className="flex flex-col items-center justify-center h-96">
              <img
                src={logo}
                alt="Tenstorrent Logo"
                className="w-10 h-10 sm:w-14 sm:h-14 transform transition duration-300 hover:scale-110"
              />
              <p className="text-gray-500 pt-10">
                Start a conversation with LLM Studio Chat...
              </p>
              <div className="mt-4">
                <div className="flex space-x-4 mt-2">
                  <Card
                    className="border border-gray-300 p-4 flex flex-col items-center cursor-pointer rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition duration-300"
                    onClick={() => setTextInput("Hello, how are you today?")}
                  >
                    <Smile className="h-6 w-6 mb-2" color="#3b82f6" />
                    <span className="dark:text-gray-300">
                      Hello, how are you today?
                    </span>
                  </Card>
                  <Card
                    className="border border-gray-300 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition duration-300"
                    onClick={() => setTextInput("Can you tell me a joke?")}
                  >
                    <Angry className="h-6 w-6 mb-2" color="#be123c" />
                    <span className="dark:text-gray-300">
                      Can you tell me a joke?
                    </span>
                  </Card>
                  <Card
                    className="border border-gray-300 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition duration-300"
                    onClick={() => setTextInput("What's the weather like?")}
                  >
                    <Sun className="h-6 w-6 mb-2" color="#eab308" />
                    <span className="dark:text-gray-300">
                      What's the weather like?
                    </span>
                  </Card>
                  <Card
                    className="border border-gray-300 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition duration-500"
                    onClick={() =>
                      setTextInput("When will Tenstorrent out sell Nvidia?")
                    }
                  >
                    <DollarSign className="h-6 w-6 mb-2" color="#22c55e" />
                    <span className="dark:text-gray-300">
                      When will Tenstorrent out sell Nvidia?
                    </span>
                  </Card>
                </div>
              </div>
            </div>
          )}
          {chatHistory.length > 0 && (
            <div className="relative flex flex-col h-full">
              <ScrollArea
                className="h-[calc(100vh-20rem)] overflow-auto p-4 border rounded-lg"
                ref={scrollAreaRef}
                onScroll={handleScroll}
              >
                {chatHistory.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${
                      message.sender === "user"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >
                    <div
                      className={`flex items-center max-w-[80%] text-left p-2 rounded-lg mb-2 ${
                        message.sender === "user"
                          ? "bg-green-600 text-white break-words"
                          : "bg-gray-700 text-gray-300 break-words"
                      }`}
                      style={{ wordBreak: "break-word" }}
                    >
                      {message.sender === "user" ? (
                        <User
                          className="h-6 w-6 mr-2 text-left"
                          color="white"
                        />
                      ) : (
                        <img
                          src={logo}
                          alt="Tenstorrent Logo"
                          className="w-8 h-8 rounded-full mr-2"
                        />
                      )}
                      <div>{message.text}</div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </ScrollArea>
              {isScrollButtonVisible && (
                <Button
                  className="fixed bottom-4 right-4 p-2 rounded-full bg-gray-700 text-white"
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
              className="px-4 py-2 border rounded-lg shadow-md w-full pr-12"
              disabled={isStreaming}
              rows={4}
            />
            <Button
              className="absolute right-2 top-2/4 transform -translate-y-2/4"
              onClick={handleInference}
              disabled={isStreaming}
            >
              {isStreaming ? (
                <div className="h-5 w-5">
                  <Spinner />
                </div>
              ) : (
                <CircleArrowUp className="h-6 w-6" />
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ChatComponent;
