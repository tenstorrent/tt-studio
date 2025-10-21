// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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
  isMobileView?: boolean;
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

const ChatExamples: React.FC<ChatExamplesProps> = ({
  logo,
  setTextInput,
  isMobileView = false,
}) => {
  // Show fewer examples on mobile to prevent crowding
  const exampleCount = isMobileView ? 2 : 4;

  const [displayedExamples, setDisplayedExamples] = useState(
    allExamples.slice(0, exampleCount)
  );

  useEffect(() => {
    const interval = setInterval(
      () => {
        setDisplayedExamples((prevExamples) => {
          const nextIndex =
            (allExamples.indexOf(prevExamples[prevExamples.length - 1]) + 1) %
            allExamples.length;
          return [
            ...allExamples.slice(nextIndex, nextIndex + exampleCount),
            ...allExamples.slice(
              0,
              Math.max(0, exampleCount - (allExamples.length - nextIndex))
            ),
          ];
        });
      },
      isMobileView ? 10000 : 15000
    ); // Rotate a bit faster on mobile

    return () => clearInterval(interval);
  }, [exampleCount, isMobileView]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[28rem] p-2 sm:p-4 transition-all duration-500 ease-out animate-in fade-in-0 slide-in-from-bottom-4">
      <img
        src={logo}
        alt="Tenstorrent Logo"
        className={`${isMobileView ? "w-12 h-12 mb-4" : "w-16 h-16 mb-6"} transform transition-all duration-500 hover:scale-110 hover:rotate-6 animate-in fade-in-0 slide-in-from-top-4 duration-700`}
      />
      <h2
        className={`${isMobileView ? "text-xl" : "text-2xl"} font-bold mb-4 sm:mb-6 text-gray-800 dark:text-white transition-all duration-300 text-center animate-in fade-in-0 slide-in-from-bottom-2 duration-700 delay-200`}
      >
        Start a conversation with TT Studio Chat...
      </h2>
      <div
        className={`grid ${isMobileView ? "grid-cols-1 gap-3" : "grid-cols-1 sm:grid-cols-2 gap-4"} w-full max-w-4xl`}
      >
        {displayedExamples.map((example, index) => (
          <Button
            key={index}
            variant="outline"
            className={`h-auto ${isMobileView ? "py-3 px-4" : "py-4 px-6"} flex flex-col items-center justify-center text-center space-y-2
                     bg-white dark:bg-[#2A2A2A] hover:bg-gray-50 dark:hover:bg-[#333333] 
                     border border-gray-200 dark:border-[#7C68FA]/20 hover:border-gray-300 dark:hover:border-[#7C68FA]/40
                     text-gray-800 dark:text-white group transition-all duration-300 shadow-sm hover:shadow-lg hover:shadow-[#7C68FA]/10
                     rounded-xl hover:rounded-2xl transform hover:scale-[1.03] active:scale-[0.97] hover:-translate-y-1
                     animate-in fade-in-0 slide-in-from-bottom-4 duration-700 backdrop-blur-sm hover:backdrop-blur-md`}
            style={{
              animationDelay: `${400 + index * 100}ms`,
              animationFillMode: "both",
            }}
            onClick={() => setTextInput(example.text)}
          >
            <span
              className={`${example.color} transition-all duration-300 transform group-hover:scale-125 group-hover:rotate-[-12deg] filter group-hover:drop-shadow-lg`}
            >
              {React.cloneElement(example.icon as React.ReactElement, {
                className: isMobileView ? "h-5 w-5" : "h-6 w-6",
              })}
            </span>
            <span
              className={`${isMobileView ? "text-xs" : "text-sm"} font-medium transition-all duration-300 group-hover:text-gray-900 dark:group-hover:text-white group-hover:font-semibold`}
            >
              {example.text}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
};

export default ChatExamples;
