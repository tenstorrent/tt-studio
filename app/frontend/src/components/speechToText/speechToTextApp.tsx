// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useEffect } from "react";
import { AppSidebar } from "@/src/components/speechToText/appSidebar";
import { MainContent } from "@/src/components/speechToText/mainContent";
import { SidebarProvider, SidebarTrigger } from "@/src/components/ui/sidebar";
import { Card } from "../ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Mic, MessageSquare } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import {
  fetchHealthyModelsByType,
  type DeployedModelSummary,
} from "../../api/modelsDeployedApis";
import type { TranscriptSegment } from "./lib/apiClient";

interface Transcription {
  id: string;
  text: string;
  date: Date;
  audioBlob?: Blob;
  segments?: TranscriptSegment[];
  sourceName?: string;
  durationSec?: number;
}

interface Conversation {
  id: string;
  title: string;
  date: Date;
  transcriptions: Transcription[];
}

export default function SpeechToTextApp() {
  if (import.meta.env.DEV) {
    console.log("Rendering SpeechToTextApp");
  }
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<
    string | null
  >(null);
  const [isRecording, setIsRecording] = useState(false);
  const [conversationCounter, setConversationCounter] = useState(1);
  const [showRecordingInterface, setShowRecordingInterface] = useState(false);
  const { theme } = useTheme();

  const location = useLocation();
  const [modelID, setModelID] = useState<string | null>(null);
  const [sttModels, setSttModels] = useState<DeployedModelSummary[]>([]);

  // List every healthy (fully warmed up) speech recognition model, so a
  // second deployment stays reachable even though the navbar only links here
  // once. Prefer the model the nav button was opened for, when it's actually
  // one of the healthy ones; otherwise fall back to the first healthy model.
  useEffect(() => {
    fetchHealthyModelsByType("speech_recognition").then((models) => {
      setSttModels(models);
      const fromNav = location.state?.containerID;
      if (fromNav && models.some((m) => m.id === fromNav)) {
        setModelID(fromNav);
      } else if (models.length > 0) {
        setModelID(models[0].id);
      } else {
        setModelID(null);
        customToast.error(
          "No speech recognition model is ready yet. Deploy or wait for one to finish warming up."
        );
      }
    });
  }, [location.state]);

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
  const handleNewTranscription = (
    text: string,
    audioBlob?: Blob,
    meta?: {
      segments?: TranscriptSegment[];
      sourceName?: string;
      durationSec?: number;
    }
  ) => {
    const transcriptionId = Date.now().toString();
    const newTranscription: Transcription = {
      id: transcriptionId,
      text,
      date: new Date(),
      audioBlob,
      segments: meta?.segments,
      sourceName: meta?.sourceName,
      durationSec: meta?.durationSec,
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
    <div
      className="w-full md:w-11/12 lg:w-4/5 h-full md:h-4/5 mx-auto my-auto p-2 md:p-4"
      style={{ paddingBottom: "var(--footer-height, 0px)" }}
    >
      {/* Main card container with subtle glow effect */}
      <Card
        className={cn(
          "flex w-full h-full shadow-xl overflow-hidden rounded-xl backdrop-blur-sm",
          theme === "dark"
            ? "bg-[#1A1A1A] border-TT-purple/20"
            : "bg-white border-TT-purple-shade/20"
        )}
      >
        <SidebarProvider defaultOpen={false}>
          <div className="flex w-full h-full">
            {/* Sidebar - has its own scrolling */}
            <div
              className={cn(
                "h-full border-r overflow-y-auto",
                theme === "dark"
                  ? "border-TT-purple/20"
                  : "border-TT-purple-shade/20"
              )}
            >
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

            <div className="flex flex-col flex-1 h-full">
              <div
                className={cn(
                  "sticky top-0 z-50 h-16 md:h-16 border-b flex items-center justify-between px-3 md:px-6",
                  theme === "dark"
                    ? "border-TT-purple/30 bg-gradient-to-r from-[#1A1A1A] via-[#222222] to-[#1A1A1A]"
                    : "border-TT-purple-shade/20 bg-gradient-to-r from-white via-gray-50 to-white"
                )}
              >
                <div className="flex items-center">
                  <SidebarTrigger className="mr-2 md:mr-4 text-TT-purple hover:text-TT-purple-accent" />
                  <h1 className="text-lg md:text-xl font-semibold text-TT-purple truncate max-w-[150px] md:max-w-full">
                    {selectedConversation
                      ? conversations.find((c) => c.id === selectedConversation)
                          ?.title || "Speech to Text"
                      : "New Conversation"}
                  </h1>
                  {selectedConversation && selectedConversationData && (
                    <div
                      className={cn(
                        "ml-2 md:ml-4 text-xs md:text-sm px-2 md:px-2.5 py-0.5 md:py-1 rounded-full",
                        theme === "dark"
                          ? "text-TT-purple-tint1 bg-TT-purple-shade/40"
                          : "text-TT-purple bg-TT-purple-shade/20"
                      )}
                    >
                      {selectedConversationData.transcriptions.length || 0}{" "}
                      {selectedConversationData.transcriptions.length === 1
                        ? "message"
                        : "messages"}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 md:gap-3">
                  {/* Model picker: keeps every healthy STT deployment reachable
                      even though the navbar links here with just one button. */}
                  <Select
                    value={modelID ?? ""}
                    onValueChange={setModelID}
                    disabled={sttModels.length === 0}
                  >
                    <SelectTrigger className="h-8 md:h-9 text-xs md:text-sm w-[120px] md:w-[200px]">
                      <SelectValue placeholder="No model ready" />
                    </SelectTrigger>
                    <SelectContent>
                      {sttModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.modelName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedConversation && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleView}
                      className={cn(
                        "text-xs md:text-sm px-2 md:px-4 py-1 md:py-2 h-8 md:h-9",
                        theme === "dark"
                          ? "border-TT-purple/40 hover:border-TT-purple bg-TT-purple-shade/30 hover:bg-TT-purple-shade/50 text-white"
                          : "border-TT-purple-shade/40 hover:border-TT-purple bg-TT-purple-shade/10 hover:bg-TT-purple-shade/20 text-gray-900"
                      )}
                    >
                      {showRecordingInterface ? (
                        <>
                          <MessageSquare className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2 text-TT-purple-accent" />
                          <span className="hidden xs:inline">View</span>{" "}
                          Conversation
                        </>
                      ) : (
                        <>
                          <Mic className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2 text-TT-purple-accent" />
                          <span className="hidden xs:inline">Record</span> Audio
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-hidden">
                <MainContent
                  conversations={conversations}
                  selectedConversation={selectedConversation}
                  onNewTranscription={handleNewTranscription}
                  isRecording={isRecording}
                  setIsRecording={setIsRecording}
                  showRecordingInterface={showRecordingInterface}
                  setShowRecordingInterface={setShowRecordingInterface}
                  modelID={modelID || ""}
                />
              </div>
            </div>
          </div>
        </SidebarProvider>
      </Card>
    </div>
  );
}
