// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type React from "react";
import { useEffect } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { Button } from "../ui/button";
import { User, Video, ChevronDown, Download, ArrowLeft } from "lucide-react";
import { Progress } from "../ui/progress";
import VideoInputArea from "./VideoInputArea";
import type { VideoGenChatProps } from "./types/chat";
import { useVideoChat } from "./hooks/useVideoChat";

const formatClock = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const VideoGenChat: React.FC<VideoGenChatProps> = ({
  onBack,
  modelID,
  initialPrompt = "",
}) => {
  const {
    messages,
    textInput,
    setTextInput,
    isGenerating,
    progress,
    isScrollButtonVisible,
    setIsScrollButtonVisible,
    viewportRef,
    lastMessageRef,
    sendMessage,
    scrollToBottom,
    handleScroll,
  } = useVideoChat(modelID);


  useEffect(() => {
    if (initialPrompt) {
      setTextInput(initialPrompt);
    }
  }, [initialPrompt, setTextInput]);

  return (
    <div className="flex flex-col w-full h-full bg-white dark:bg-[#0a0b0f]">
      <div className="bg-white dark:bg-[#2A2A2A] border-b border-gray-200 dark:border-[#7C68FA]/20 px-6 py-3 flex items-center gap-3 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="text-gray-600 dark:text-white/80 hover:text-gray-900 dark:hover:text-white"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Video className="h-5 w-5 text-[#7C68FA]" />
          <span className="font-semibold text-gray-900 dark:text-white">Video Generation</span>
        </div>
      </div>

      <ScrollArea.Root className="grow overflow-hidden">
        <ScrollArea.Viewport
          ref={viewportRef}
          className="w-full h-full lg:pr-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-transparent hover:scrollbar-thumb-gray-500"
          onScroll={handleScroll}
        >
          <div className="p-6 space-y-6">
            {messages.map((message, index) => (
              <div
                key={message.id}
                ref={index === messages.length - 1 ? lastMessageRef : null}
                className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`flex items-start gap-3 max-w-[90%] ${
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
                          src={message.video}
                          controls
                          className="rounded-lg w-full max-w-md h-auto max-h-80 object-contain"
                          aria-label="Generated video"
                        />
                        <div className="mt-1 flex justify-end">
                          <a
                            href={message.video}
                            download={`generated-video-${message.id}.mp4`}
                            className="text-xs text-[#7C68FA] flex items-center gap-1 hover:underline"
                            aria-label="Download video"
                          >
                            <Download className="h-3 w-3" /> Download
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
                  <div className="h-8 w-8 bg-[#7C68FA] rounded-full flex items-center justify-center">
                    <Video className="h-5 w-5 text-white" />
                  </div>
                  <div className="bg-gray-100 dark:bg-TT-slate text-gray-900 dark:text-white p-3 rounded-lg w-64">
                    <p className="text-sm font-medium">
                      {!progress || progress.phase === "queued"
                        ? "Queued…"
                        : progress.percent >= 99
                          ? "Finishing up…"
                          : "Generating your video…"}
                    </p>
                    <Progress
                      value={progress?.percent ?? 0}
                      className="mt-2 bg-gray-300 dark:bg-[#1a1c2a]"
                      indicatorClassName="bg-[#7C68FA]"
                    />
                    {progress && progress.phase === "in_progress" ? (
                      <p className="mt-1 text-xs text-gray-500 dark:text-white/60">
                        {formatClock(progress.elapsedSeconds)} / ~
                        {formatClock(progress.estimatedSeconds)}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-gray-500 dark:text-white/60">
                        Waiting for the model…
                      </p>
                    )}
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
          className="absolute bottom-44 xl:bottom-20 right-4 rounded-full shadow-lg bg-[#7C68FA] text-white hover:bg-[#7C68FA]/80 transition-all duration-300"
          onClick={() => {
            scrollToBottom();
            setIsScrollButtonVisible(false);
          }}
        >
          <ChevronDown className="h-6 w-6 animate-bounce" />
        </Button>
      )}

      <div className="p-6">
        <div className="max-w-5xl mx-auto">
          <VideoInputArea
            textInput={textInput}
            setTextInput={setTextInput}
            handleGenerate={sendMessage}
            isGenerating={isGenerating}
          />
        </div>
      </div>
    </div>
  );
};

export default VideoGenChat;
