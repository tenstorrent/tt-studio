// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import { Card } from "./ui/card";
import { MessageCircle, Smile, CloudSun, Lightbulb } from "lucide-react";

interface ChatExamplesProps {
  logo: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
}

const ChatExamples: React.FC<ChatExamplesProps> = ({ logo, setTextInput }) => {
  return (
    <div className="flex flex-col items-center justify-center h-96">
      <img
        src={logo}
        alt="Tenstorrent Logo"
        className="w-10 h-10 sm:w-14 sm:h-14 transform transition duration-300 hover:scale-110"
      />
      <p className="text-gray-500 pt-9 font-rmMono">
        Start a conversation with LLM Studio Chat...
      </p>
      <div className="mt-4">
        <div className="flex space-x-4 mt-2">
          <Card
            className="border border-gray-300 p-4 flex flex-col items-center cursor-pointer rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition duration-300"
            onClick={() => setTextInput("Hello, how are you today?")}
          >
            <MessageCircle className="h-6 w-6 mb-2" color="#3b82f6" />
            <span className="dark:text-gray-300">
              Hello, how are you today?
            </span>
          </Card>
          <Card
            className="border border-gray-300 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition duration-300"
            onClick={() => setTextInput("Can you tell me a joke?")}
          >
            <Smile className="h-6 w-6 mb-2" color="#be123c" />
            <span className="dark:text-gray-300">Can you tell me a joke?</span>
          </Card>
          <Card
            className="border border-gray-300 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition duration-300"
            onClick={() => setTextInput("What's the weather like?")}
          >
            <CloudSun className="h-6 w-6 mb-2" color="#eab308" />
            <span className="dark:text-gray-300">What's the weather like?</span>
          </Card>
          <Card
            className="border border-gray-300 rounded-lg p-4 flex flex-col items-center cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition duration-500"
            onClick={() => setTextInput("Tell me a fun fact.")}
          >
            <Lightbulb className="h-6 w-6 mb-2" color="#22c55e" />
            <span className="dark:text-gray-300">Tell me a fun fact.</span>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ChatExamples;
