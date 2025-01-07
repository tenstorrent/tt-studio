import React, { useState } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { Button } from "../ui/button";
import { User, Camera, ChevronDown, Download } from 'lucide-react';
import { Skeleton } from "../ui/skeleton";
import Header from './Header';
import ImageInputArea from './ImageInputArea';
import { StableDiffusionChatProps } from './types/chat';
import { useChat } from './hooks/useChat';

const StableDiffusionChat: React.FC<StableDiffusionChatProps> = ({ onBack }) => {
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
  } = useChat();

  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false);

  return (
    <div className="flex flex-col w-full h-full bg-[#0a0b0f]">
      <Header
        onBack={onBack}
        isHistoryPanelOpen={isHistoryPanelOpen}
        setIsHistoryPanelOpen={setIsHistoryPanelOpen}
      />

      <ScrollArea.Root className="flex-grow overflow-hidden">
        <ScrollArea.Viewport
          ref={viewportRef}
          className="w-full h-full pr-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-transparent hover:scrollbar-thumb-gray-500"
          onScroll={handleScroll}
        >
          <div className="p-6 space-y-8">
            {messages.map((message, index) => (
              <div
                key={message.id}
                ref={index === messages.length - 1 ? lastMessageRef : null}
                className={`flex ${
                  message.sender === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`flex items-start gap-3 max-w-[90%] ${
                    message.sender === "user" ? "flex-row-reverse" : "flex-row"
                  }`}
                >
                  <div className="flex-shrink-0">
                    {message.sender === "user" ? (
                      <div className="h-8 w-8 bg-white rounded-full flex items-center justify-center text-black">
                        <User className="h-5 w-5" />
                      </div>
                    ) : (
                      <div className="h-8 w-8 bg-[#7C68FA] rounded-full flex items-center justify-center">
                        <Camera className="h-5 w-5 text-white" />
                      </div>
                    )}
                  </div>
                  <div
                    className={`relative rounded-2xl p-4 ${
                      message.sender === "user"
                        ? "bg-[#7C68FA] rounded-tr-none"
                        : "bg-[#1a1c2a] rounded-tl-none"
                    }`}
                  >
                    <div
                      className={`absolute top-0 w-4 h-4 ${
                        message.sender === "user"
                          ? "-right-2 bg-[#7C68FA]"
                          : "-left-2 bg-[#1a1c2a]"
                      }`}
                      style={{
                        clipPath: message.sender === "user"
                          ? "polygon(0 0, 0% 100%, 100% 0)"
                          : "polygon(0 0, 100% 100%, 100% 0)"
                      }}
                    ></div>
                    <p className="text-white">{message.text}</p>
                    {message.image && (
                      <div className="relative mt-2 group">
                        <img
                          src={message.image}
                          alt="Generated image"
                          className="rounded-lg max-w-full h-auto transition-opacity duration-300 group-hover:opacity-80"
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <a
                            href={message.image}
                            download={`generated-image-${message.id}.jpg`}
                            className="bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-70 transition-colors duration-300"
                            aria-label="Download image"
                          >
                            <Download className="h-6 w-6" />
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isGenerating && (
              <div className="flex justify-start">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 bg-[#7C68FA] rounded-full flex items-center justify-center">
                    <Camera className="h-5 w-5 text-white" />
                  </div>
                  <Skeleton className="h-32 w-32 rounded-lg bg-[#1a1c2a]" />
                </div>
              </div>
            )}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          orientation="vertical"
          className="w-2 bg-transparent transition-colors duration-150 ease-out hover:bg-gray-700"
        >
          <ScrollArea.Thumb className="bg-gray-600 rounded-full w-full transition-colors duration-150 ease-out hover:bg-gray-500" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>

      {isScrollButtonVisible && (
        <Button
          className="absolute bottom-20 right-4 rounded-full shadow-lg bg-[#7C68FA] text-white hover:bg-[#7C68FA]/80 transition-all duration-300"
          onClick={() => {
            scrollToBottom();
            setIsScrollButtonVisible(false);
          }}
        >
          <ChevronDown className="h-6 w-6 animate-bounce" />
        </Button>
      )}

      <div className="p-10 ">
        <div className="max-w-5xl mx-auto">
          <ImageInputArea
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

export default StableDiffusionChat;

