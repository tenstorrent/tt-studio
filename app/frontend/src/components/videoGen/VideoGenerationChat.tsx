// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type React from "react";
import { useState, useEffect } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { Button } from "../ui/button";
import { User, Video, ChevronDown, Download } from "lucide-react";
import { Skeleton } from "../ui/skeleton";
import { LoadingDots } from "../ui/loading-dots";
import Header from "./Header";
import VideoInputArea from "./VideoInputArea";
import type { VideoGenerationChatProps } from "./types/chat";
import { useVideoChat } from "./hooks/useVideoChat";

const VideoGenerationChat: React.FC<VideoGenerationChatProps> = ({
  onBack,
  modelID,
  initialPrompt = "",
}) => {
  const {
    messages,
    textInput,
    setTextInput,
    isGenerating,
    isScrollButtonVisible,
    setIsScrollButtonVisible,
    viewportRef,
    lastMessageRef,
    sendMessage,
    scrollToBottom,
    handleScroll,
  } = useVideoChat(modelID);

  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);
  const [screenSize, setScreenSize] = useState({
    isMobileView: false,
  });

  useEffect(() => {
    if (initialPrompt) {
      setTextInput(initialPrompt);
    }
  }, [initialPrompt, setTextInput]);

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      setScreenSize({
        isMobileView: width < 768,
      });
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="flex flex-col w-full h-full bg-white dark:bg-[#0a0b0f] overflow-hidden">
      <div
        className={`${screenSize.isMobileView ? "sticky top-0 z-10 bg-background" : ""}`}
      >
        <Header
          onBack={onBack}
          isHistoryPanelOpen={isHistoryPanelOpen}
          setIsHistoryPanelOpen={setIsHistoryPanelOpen}
        />
      </div>

      <ScrollArea.Root className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea.Viewport
          ref={viewportRef}
          className={`w-full h-full overflow-y-auto relative ${
            screenSize.isMobileView
              ? "px-3 pb-[140px] pt-4"
              : "px-4 sm:px-6 md:px-8"
          }`}
          onScroll={handleScroll}
        >
          <div className="space-y-4 sm:space-y-6 py-4">
            {messages.map((message, index) => (
              <div
                key={message.id}
                ref={index === messages.length - 1 ? lastMessageRef : null}
                className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`flex items-start gap-2 sm:gap-3 max-w-[85%] sm:max-w-[80%] md:max-w-[75%] lg:max-w-[70%] ${
                    message.sender === "user" ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <div className="shrink-0">
                    {message.sender === "user" ? (
                      <div className="h-8 w-8 bg-[#7C68FA] rounded-full flex items-center justify-center text-white">
                        <User className="h-5 w-5" />
                      </div>
                    ) : (
                      <div className="h-8 w-8 bg-[#7C68FA] rounded-full flex items-center justify-center">
                        <Video className="h-5 w-5 text-white" />
                      </div>
                    )}
                  </div>
                  <div
                    className={`chat-bubble relative ${
                      message.sender === "user"
                        ? "bg-TT-green-accent text-white text-left"
                        : "bg-gray-100 dark:bg-TT-slate text-gray-900 dark:text-white text-left"
                    } p-3 rounded-lg mb-1`}
                  >
                    <p
                      className={
                        message.sender === "user"
                          ? "text-white"
                          : "text-gray-900 dark:text-white"
                      }
                    >
                      {message.text}
                    </p>
                    {message.video && (
                      <div className="relative mt-2 group">
                        <video
                          src={message.video || "/placeholder.mp4"}
                          controls
                          className="rounded-lg w-full max-w-full sm:max-w-xl md:max-w-2xl h-auto max-h-64 sm:max-h-80 md:max-h-96 object-contain transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-xl"
                        />
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <a
                            href={message.video}
                            download={`generated-video-${message.id}.mp4`}
                            className="bg-[#7C68FA] hover:bg-[#7C68FA]/90 text-white p-3 rounded-full shadow-lg transition-all duration-300 flex items-center justify-center"
                            aria-label="Download video"
                          >
                            <Download className="h-5 w-5" />
                          </a>
                        </div>
                      </div>
                    )}
                    <div
                      className={`absolute w-2 h-2 ${
                        message.sender === "user"
                          ? "bg-TT-green-accent right-0 -translate-x-1/2"
                          : "bg-TT-slate dark:bg-TT-slate bg-gray-100 left-0 translate-x-1/2"
                      } rotate-45 top-3`}
                    ></div>
                  </div>
                </div>
              </div>
            ))}
            {isGenerating && (
              <div className="flex justify-start">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 bg-[#7C68FA] rounded-full flex items-center justify-center animate-pulse">
                    <Video className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex flex-col gap-3 bg-gray-100 dark:bg-TT-slate p-3 sm:p-4 rounded-lg border-2 border-[#7C68FA] animate-[pulse_3s_ease-in-out_infinite]">
                    <Skeleton className="h-32 sm:h-40 md:h-48 w-full sm:w-80 md:w-96 rounded-lg bg-gray-200 dark:bg-[#1a1c2a]" />
                    <div className="flex flex-col gap-2">
                      <LoadingDots size={4}>
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          Generating your video
                        </span>
                      </LoadingDots>
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        This typically takes 2-3 minutes. Please keep this tab
                        open.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          orientation="vertical"
          className="w-2 bg-transparent transition-colors duration-150 ease-out hover:bg-gray-300 dark:hover:bg-gray-700"
        >
          <ScrollArea.Thumb className="bg-gray-400 dark:bg-gray-600 rounded-full w-full transition-colors duration-150 ease-out hover:bg-gray-500 dark:hover:bg-gray-500" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>

      {isScrollButtonVisible && (
        <Button
          className="fixed bottom-40 right-4 sm:right-8 md:right-12 z-50 p-2 rounded-full bg-gray-800 text-white shadow-lg hover:bg-gray-700 transition-colors"
          onClick={() => {
            scrollToBottom();
            setIsScrollButtonVisible(false);
          }}
        >
          <ChevronDown className="h-6 w-6" />
        </Button>
      )}

      <div
        className={`${
          screenSize.isMobileView
            ? "fixed bottom-0 left-0 right-0 bg-background border-t border-gray-200 dark:border-gray-800 shadow-lg px-2 pb-safe"
            : "relative"
        }`}
        style={{
          paddingBottom: screenSize.isMobileView
            ? "env(safe-area-inset-bottom, 16px)"
            : undefined,
        }}
      >
        <VideoInputArea
          textInput={textInput}
          setTextInput={setTextInput}
          handleGenerate={sendMessage}
          isGenerating={isGenerating}
        />
      </div>
    </div>
  );
};

export default VideoGenerationChat;
