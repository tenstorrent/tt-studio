import React, { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { useLocation } from "react-router-dom";
import { Spinner } from "./ui/spinner";
import {
  Bot,
  Smile,
  Sun,
  User,
  Angry,
  DollarSign,
  CircleArrowUp,
} from "lucide-react";
import { Textarea } from "./ui/textarea";
import logo from "../assets/tt_logo.svg";

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
  const location = useLocation();
  const [textInput, setTextInput] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [modelID, setModelID] = useState(location.state.containerID);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    setModelID(location.state.containerID);
  }, [location.state.containerID]);

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

      // Add user input to chat history
      setChatHistory((prevHistory) => [
        ...prevHistory,
        { sender: "user", text: textInput },
      ]);

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
        }
      }

      setIsStreaming(false);
    } catch (error) {
      console.error("Error running inference:", error);
      setIsStreaming(false);
    }
  };

  const handleInference = () => {
    const inferenceRequest: InferenceRequest = {
      deploy_id: modelID,
      text: textInput,
    };
    console.log("Inference Request:", inferenceRequest);

    // Special case for the predefined question
    if (textInput === "When will Tenstorrent out sell Nvidia?") {
      setChatHistory((prevHistory) => [
        ...prevHistory,
        { sender: "user", text: textInput },
        { sender: "assistant", text: "2024, that was a silly question." },
      ]);
      setTextInput("");
      return;
    }

    runInference(inferenceRequest);
    setTextInput("");
  };

  return (
    <div className="flex flex-col h-screen w-10/12 pt-28 mx-auto">
      <Card>
        <div className="flex flex-col w-full h-full p-8">
          {chatHistory.length === 0 && (
            <div className="flex flex-col items-center justify-center h-96">
              <img
                src={logo}
                alt="Tenstorrent Logo"
                className="w-10 h-10 sm:w-14 sm:h-14 rounded-full shadow-inner transform transition duration-300 hover:scale-110"
              />
              <p className="text-gray-500 pt-10">
                Start a conversation with LLM Studio Chat...
              </p>
              <div className="mt-4">
                <p>Examples:</p>
                <div className="flex space-x-4 mt-2">
                  <Card
                    className="border border-gray-300 p-4 flex flex-col items-center cursor-pointer rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-700 transition duration-300"
                    onClick={() => setTextInput("Hello, how are you today?")}
                  >
                    <Smile className="h-6 w-6 mb-2" />
                    <span>Hello, how are you today?</span>
                  </Card>
                  <Card
                    className="border border-gray-300 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:bg-zinc-800 dark:hover:bg-zinc-700 transition duration-300"
                    onClick={() => setTextInput("Can you tell me a joke?")}
                  >
                    <Angry className="h-6 w-6 mb-2" />
                    <span>Can you tell me a joke?</span>
                  </Card>
                  <Card
                    className="border border-gray-300 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:bg-zinc-800 dark:hover:bg-zinc-700 transition duration-300"
                    onClick={() => setTextInput("What's the weather like?")}
                  >
                    <Sun className="h-6 w-6 mb-2" />
                    <span>What's the weather like?</span>
                  </Card>
                  <Card
                    className="border border-gray-300 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:bg-zinc-800 dark:hover:bg-zinc-700 transition duration-500"
                    onClick={() =>
                      setTextInput("When will Tenstorrent out sell Nvidia?")
                    }
                  >
                    <DollarSign className="h-6 w-6 mb-2" />
                    <span>When will Tenstorrent out sell Nvidia?</span>
                  </Card>
                </div>
              </div>
            </div>
          )}
          {chatHistory.length > 0 && (
            <ScrollArea className="h-[calc(100vh-38rem)] overflow-auto p-4 border rounded">
              <h3 className="font-bold mb-4">Chat Responses:</h3>
              {chatHistory.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${
                    message.sender === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`flex items-center text-left p-2 rounded-lg mb-2 ${
                      message.sender === "user"
                        ? "bg-green-600 text-white"
                        : "bg-gray-700 text-gray-300"
                    }`}
                  >
                    {message.sender === "user" ? (
                      <User className="h-6 w-6 mr-2 text-left" />
                    ) : (
                      <Bot className="h-6 w-6 mr-2 text-left" />
                    )}
                    {message.text}
                  </div>
                </div>
              ))}
            </ScrollArea>
          )}
          <div className="flex items-center pt-4 relative">
            <Textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Enter text for inference"
              className="px-4 py-2 border rounded shadow-md w-full pr-12"
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
