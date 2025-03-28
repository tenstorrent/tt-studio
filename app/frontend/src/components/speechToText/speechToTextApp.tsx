// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect } from "react";
import { AppSidebar } from "@/src/components/speechToText/appSidebar";
import { MainContent } from "@/src/components/speechToText/mainContent";
import { SidebarProvider, SidebarTrigger } from "@/src/components/ui/sidebar";
import { Card } from "../ui/card";

interface Transcription {
  id: string;
  text: string;
  date: Date;
  audioBlob?: Blob;
}

interface Conversation {
  id: string;
  title: string;
  date: Date;
  transcriptions: Transcription[];
}

export default function SpeechToTextApp() {
  console.log("Rendering SpeechToTextApp");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<
    string | null
  >(null);
  const [isRecording, setIsRecording] = useState(false);
  const [conversationCounter, setConversationCounter] = useState(1);
  const [showRecordingInterface, setShowRecordingInterface] = useState(false);

  // Function to create a new conversation
  const handleNewConversation = () => {
    const id = Date.now().toString();
    const newConversation = {
      id,
      title: `Conversation ${conversationCounter}`,
      date: new Date(),
      transcriptions: [],
    };

    setConversations((prev) => [newConversation, ...prev]);
    setSelectedConversation(id);
    setConversationCounter((prev) => prev + 1);
    setIsRecording(true);
    setShowRecordingInterface(true);

    return id;
  };

  // Function to add a new transcription to a conversation
  const handleNewTranscription = (text: string, audioBlob: Blob) => {
    const transcriptionId = Date.now().toString();
    const newTranscription = {
      id: transcriptionId,
      text,
      date: new Date(),
      audioBlob,
    };

    // If no conversation is selected, create a new one
    if (!selectedConversation) {
      const conversationId = handleNewConversation();

      setConversations((prev) => {
        return prev.map((convo) => {
          if (convo.id === conversationId) {
            return {
              ...convo,
              transcriptions: [newTranscription],
            };
          }
          return convo;
        });
      });

      return conversationId;
    }

    // Add transcription to existing conversation
    setConversations((prev) => {
      return prev.map((convo) => {
        if (convo.id === selectedConversation) {
          return {
            ...convo,
            transcriptions: [...convo.transcriptions, newTranscription],
          };
        }
        return convo;
      });
    });

    return selectedConversation;
  };

  // Load counter from localStorage on initial load
  useEffect(() => {
    const savedCounter = localStorage.getItem("conversationCounter");
    if (savedCounter) {
      setConversationCounter(Number.parseInt(savedCounter));
    }
  }, []);

  // Save counter to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("conversationCounter", conversationCounter.toString());
  }, [conversationCounter]);

  return (
    <div className="w-4/5 h-4/5 mx-auto my-auto p-4">
      <Card className="flex flex-col w-full h-full overflow-hidden shadow-xl bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-TT-purple/20 backdrop-blur-sm">
        <div className="flex-1 overflow-hidden flex flex-col relative">
          <SidebarProvider defaultOpen={true}>
            <div className="flex h-full w-full relative">
              {/* Sidebar component */}
              <div className="border-r border-gray-200 dark:border-TT-purple/20 overflow-y-auto">
                <AppSidebar
                  conversations={conversations}
                  selectedConversation={selectedConversation}
                  onSelectConversation={(id) => {
                    setSelectedConversation(id);
                    setIsRecording(false);
                    setShowRecordingInterface(false);
                  }}
                  onNewConversation={handleNewConversation}
                />
              </div>

              {/* Main content area */}
              <div className="flex flex-col flex-1 bg-white dark:bg-[#2A2A2A] border-l border-gray-200 dark:border-TT-purple/20 min-w-0 min-h-0">
                {/* Fixed header - moved outside scrollable container and made sticky */}
                <div className="h-14 border-b border-gray-200 dark:border-TT-purple/20 flex items-center px-4 bg-gray-100 dark:bg-[#222222] shrink-0 sticky top-0 z-10">
                  <SidebarTrigger className="mr-4 text-TT-purple hover:text-TT-purple-accent" />
                  <h1 className="text-xl font-semibold text-TT-purple dark:text-TT-purple truncate">
                    {selectedConversation
                      ? conversations.find((c) => c.id === selectedConversation)
                          ?.title || "Speech to Text"
                      : "New Conversation"}
                  </h1>
                </div>

                {/* Content wrapper - now header is outside */}
                <div className="flex-1 overflow-hidden bg-gray-50 dark:bg-[#2A2A2A] border-t border-gray-200 dark:border-TT-purple/20 min-h-0">
                  <MainContent
                    conversations={conversations}
                    selectedConversation={selectedConversation}
                    onNewTranscription={handleNewTranscription}
                    isRecording={isRecording}
                    setIsRecording={setIsRecording}
                  />
                </div>
              </div>
            </div>
          </SidebarProvider>
        </div>
      </Card>
    </div>
  );
}
