// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect } from "react";
import { AppSidebar } from "@/src/components/speechToText/appSidebar";
import { MainContent } from "@/src/components/speechToText/mainContent";
import { SidebarProvider, SidebarTrigger } from "@/src/components/ui/sidebar";
import { Card } from "../ui/card";
import { Mic, MessageSquare } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "../../lib/utils";

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

  // Toggle between recording interface and transcription view
  const toggleView = () => {
    setShowRecordingInterface(!showRecordingInterface);
  };

  // Get selected conversation data
  const selectedConversationData = selectedConversation
    ? conversations.find((c) => c.id === selectedConversation)
    : null;

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
      {/* Main card container */}
      <Card className="flex w-full h-full shadow-xl bg-white dark:bg-[#2A2A2A] border-gray-200 dark:border-TT-purple/20 backdrop-blur-sm overflow-hidden">
        <SidebarProvider defaultOpen={true}>
          <div className="flex w-full h-full">
            {/* Sidebar - has its own scrolling */}
            <div className="h-full border-r border-gray-200 dark:border-TT-purple/20 overflow-y-auto">
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

            {/* Main content area - strict layout */}
            <div className="flex flex-col flex-1 h-full">
              {/* Unified header - combines app title, conversation title and toggle button */}
              <div className="sticky top-0 z-50 h-14 border-b border-gray-200 dark:border-TT-purple/20 flex items-center justify-between px-4 bg-gray-800 dark:bg-[#222222]">
                <div className="flex items-center">
                  <SidebarTrigger className="mr-4 text-TT-purple hover:text-TT-purple-accent" />
                  <h1 className="text-xl font-semibold text-TT-purple dark:text-TT-purple truncate">
                    {selectedConversation
                      ? conversations.find((c) => c.id === selectedConversation)
                          ?.title || "Speech to Text"
                      : "New Conversation"}
                  </h1>
                  {selectedConversation && selectedConversationData && (
                    <div className="ml-4 text-sm text-TT-purple dark:text-TT-purple">
                      {selectedConversationData.transcriptions.length || 0}{" "}
                      {selectedConversationData.transcriptions.length === 1
                        ? "message"
                        : "messages"}
                    </div>
                  )}
                </div>

                {/* Toggle view button - moved to header */}
                {selectedConversation && (
                  <div className="flex items-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleView}
                      className={cn(
                        "text-sm px-4",
                        "border-TT-purple/40 hover:border-TT-purple",
                        "hover:bg-TT-purple/10",
                        "text-white"
                      )}
                    >
                      {showRecordingInterface ? (
                        <>
                          <MessageSquare className="h-4 w-4 mr-2 text-TT-purple-accent" />
                          View Conversation
                        </>
                      ) : (
                        <>
                          <Mic className="h-4 w-4 mr-2 text-TT-purple-accent" />
                          Record New Audio
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* Content wrapper - takes remaining height and handles all scrolling */}
              <div className="flex-1 overflow-hidden">
                <MainContent
                  conversations={conversations}
                  selectedConversation={selectedConversation}
                  onNewTranscription={handleNewTranscription}
                  isRecording={isRecording}
                  setIsRecording={setIsRecording}
                  showRecordingInterface={showRecordingInterface}
                  setShowRecordingInterface={setShowRecordingInterface}
                />
              </div>
            </div>
          </div>
        </SidebarProvider>
      </Card>
    </div>
  );
}
