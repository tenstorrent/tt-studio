// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { useState, useEffect } from "react";
import { Button } from "../ui/button";
import {
  MessageCircle,
  Smile,
  CloudSun,
  Lightbulb,
  Code,
  Book,
  Globe,
  Rocket,
} from "lucide-react";

interface ChatExamplesProps {
  logo: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
}

const allExamples = [
  {
    icon: <MessageCircle className="h-6 w-6" />,
    text: "Hello, how are you today?",
    color: "text-blue-500 dark:text-blue-400",
  },
  {
    icon: <Smile className="h-6 w-6" />,
    text: "Can you tell me a joke?",
    color: "text-red-500 dark:text-red-400",
  },
  {
    icon: <CloudSun className="h-6 w-6" />,
    text: "What's the weather like?",
    color: "text-yellow-500 dark:text-yellow-400",
  },
  {
    icon: <Lightbulb className="h-6 w-6" />,
    text: "Tell me a fun fact.",
    color: "text-green-500 dark:text-green-400",
  },
  {
    icon: <Code className="h-6 w-6" />,
    text: "Explain a coding concept.",
    color: "text-purple-500 dark:text-purple-400",
  },
  {
    icon: <Book className="h-6 w-6" />,
    text: "Recommend a book to read.",
    color: "text-pink-500 dark:text-pink-400",
  },
  {
    icon: <Globe className="h-6 w-6" />,
    text: "Describe a random country.",
    color: "text-teal-500 dark:text-teal-400",
  },
  {
    icon: <Rocket className="h-6 w-6" />,
    text: "Share a space exploration fact.",
    color: "text-orange-500 dark:text-orange-400",
  },
];

const ChatExamples: React.FC<ChatExamplesProps> = ({ logo, setTextInput }) => {
  const [displayedExamples, setDisplayedExamples] = useState(
    allExamples.slice(0, 4),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayedExamples((prevExamples) => {
        const nextIndex =
          (allExamples.indexOf(prevExamples[3]) + 1) % allExamples.length;
        return [
          ...allExamples.slice(nextIndex, nextIndex + 4),
          ...allExamples.slice(
            0,
            Math.max(0, 4 - (allExamples.length - nextIndex)),
          ),
        ];
      });
    }, 5000); // Cycle every 5 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[28rem] p-4 transition-colors duration-200">
      <img
        src={logo}
        alt="Tenstorrent Logo"
        className="w-16 h-16 mb-6 transform transition duration-300 hover:scale-110"
      />
      <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-gray-200 transition-colors duration-200">
        Start a conversation with LLM Studio Chat...
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-4xl">
        {displayedExamples.map((example, index) => (
          <Button
            key={index}
            variant="outline"
            className={`h-auto py-4 px-6 flex flex-col items-center justify-center text-center space-y-2 transition-all duration-300 
                        bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 
                        border border-gray-200 dark:border-gray-600
                        text-gray-800 dark:text-gray-200`}
            onClick={() => setTextInput(example.text)}
          >
            <span className={`${example.color} transition-colors duration-200`}>
              {example.icon}
            </span>
            <span className="text-sm font-medium">{example.text}</span>
          </Button>
        ))}
      </div>
    </div>
  );
};

export default ChatExamples;
