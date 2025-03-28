import { useState, useEffect } from "react";
import { AppSidebar } from "@/src/components/speechToText/appSidebar";
import { MainContent } from "@/src/components/speechToText/mainContent";
import { SidebarProvider, SidebarTrigger } from "@/src/components/ui/sidebar";
import { Card } from "../ui/card";
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";

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

  const location = useLocation();
  const [modelID, setModelID] = useState<string | null>(null);

  useEffect(() => {
    if (location.state) {
      if (!location.state.containerID) {
        customToast.error(
          "modelID is unavailable. Try navigating here from the Models Deployed tab",
        );
        return;
      }
      setModelID(location.state.containerID);
      console.log(location.state.containerID);
    }
  }, [location.state, modelID]);

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
    <div className="flex flex-col overflow-auto w-10/12 mx-auto">
      <Card className="flex flex-col w-full h-full shadow-lg">
        <div className="flex h-screen w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2] relative">
          <div className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white [mask-image:radial-gradient(ellipse_at_center,transparent_60%,black_100%)]" />

          <SidebarProvider defaultOpen={true}>
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

            <div className="flex flex-col flex-1">
              <div className="h-14 border-b flex items-center px-4">
                <SidebarTrigger className="mr-4" />
                <h1 className="text-xl font-semibold">
                  {selectedConversation
                    ? conversations.find((c) => c.id === selectedConversation)
                        ?.title || "Speech to Text"
                    : "New Conversation"}
                </h1>
              </div>

              <MainContent
                conversations={conversations}
                selectedConversation={selectedConversation}
                onNewTranscription={handleNewTranscription}
                isRecording={isRecording}
                setIsRecording={setIsRecording}
                modelID={modelID}
              />
            </div>
          </SidebarProvider>
        </div>
      </Card>
    </div>
  );
}
