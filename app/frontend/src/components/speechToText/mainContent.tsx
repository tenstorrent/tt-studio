import { useState, useEffect, useRef } from "react";
import {
  Loader2,
  Copy,
  Save,
  Trash2 as Trash,
  Mic,
  MessageSquare,
  Clock,
  Pencil as Edit,
  Play,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { AudioRecorderWithVisualizer } from "@/src/components/speechToText/AudioRecorderWithVisualizer";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { sendAudioRecording } from "./lib/apiClient";
import { useTheme } from "../../hooks/useTheme";

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

interface MainContentProps {
  conversations: Conversation[];
  selectedConversation: string | null;
  onNewTranscription: (text: string, audioBlob: Blob) => string;
  isRecording: boolean;
  setIsRecording: (isRecording: boolean) => void;
  showRecordingInterface: boolean;
  setShowRecordingInterface: (show: boolean) => void;
  modelID: string;
}

type ScrollBehavior = "auto" | "instant" | "smooth";

export function MainContent({
  conversations,
  selectedConversation,
  onNewTranscription,
  isRecording,
  setIsRecording,
  showRecordingInterface,
  setShowRecordingInterface,
  modelID,
}: MainContentProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [_audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [justSentRecording, setJustSentRecording] = useState(false);
  const [hasRecordedBefore, setHasRecordedBefore] = useState(false);
  const [forceShowTranscription, setForceShowTranscription] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const { theme } = useTheme();

  const contentContainerRef = useRef<HTMLDivElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const selectedConversationData = selectedConversation
    ? conversations.find((c) => c.id === selectedConversation)
    : null;

  // Improved scroll to bottom helper
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (contentContainerRef.current) {
      // Force a layout calculation to ensure accurate heights
      void contentContainerRef.current.offsetHeight; // Force layout calculation

      // Use scrollTo with behavior parameter
      setTimeout(() => {
        if (contentContainerRef.current) {
          const containerHeight = contentContainerRef.current.clientHeight;
          const contentHeight = contentContainerRef.current.scrollHeight;
          contentContainerRef.current.scrollTo({
            top: contentHeight - containerHeight + 200, // Add extra 200px to ensure it's fully scrolled
            behavior: behavior,
          });

          console.log("Scrolling to bottom:", {
            scrollHeight: contentHeight,
            clientHeight: containerHeight,
            scrollTop: contentHeight - containerHeight,
          });
        }
      }, 100);
    }
  };

  // Handle recording complete
  const handleRecordingComplete = async (recordedBlob: Blob) => {
    console.log("Recording completed, blob type:", recordedBlob.type, "size:", recordedBlob.size);
    setAudioBlob(recordedBlob);
    setHasRecordedBefore(true);

    // Process the audio with the API
    await processAudioWithAPI(recordedBlob);

    // Set a flag to force showing the transcription view after processing
    setForceShowTranscription(true);
  };

  const processAudioWithAPI = async (audioBlob: Blob) => {
    setIsProcessing(true);

    try {
      console.log("Processing audio with API, type:", audioBlob.type);

      // Use the sendAudioRecording function instead of direct fetch
      const data = await sendAudioRecording(audioBlob, { modelID });

      // Create the new transcription and add it to the conversation
      const transcriptionText = data.text;
      onNewTranscription(transcriptionText, audioBlob);

      // Set flag that we just sent a recording
      setJustSentRecording(true);

      // IMPORTANT: Switch to conversation view to show the transcription
      setShowRecordingInterface(false);

      // Ensure the view is scrolled to the new message
      setTimeout(() => {
        if (autoScrollEnabled) {
          scrollToBottom();
        }
      }, 500); // Increased timeout for more reliable scrolling

      console.log("Transcription successful:", transcriptionText);
    } catch (error) {
      console.error("Error processing audio:", error);
      alert(`Transcription Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Copy transcription to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Save edited transcription
  const saveTranscription = () => {
    setIsEditing(null);
  };

  // Start a new recording
  const startNewRecording = () => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = "";
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    setIsRecording(true);
    setShowRecordingInterface(true);
    setJustSentRecording(false);
    setHasRecordedBefore(true);
    setForceShowTranscription(false);

    setTimeout(() => {
      console.log("Starting new recording session");
    }, 100);
  };

  // Format time for display
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // Format date for display
  const formatDate = (date: Date) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  };

  // Group transcriptions by date
  const groupTranscriptionsByDate = (transcriptions: Transcription[]) => {
    const groups: Record<string, Transcription[]> = {};

    transcriptions.forEach((transcription) => {
      const dateKey = formatDate(transcription.date);
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(transcription);
    });

    return Object.entries(groups).map(([date, items]) => ({
      date,
      items,
    }));
  };

  // Initialize the view when a conversation is loaded
  useEffect(() => {
    if (selectedConversationData) {
      console.log("Selected conversation changed, initializing view");

      // Slight delay to ensure the DOM is ready
      setTimeout(() => {
        if (selectedConversationData.transcriptions.length > 0) {
          scrollToBottom("auto");
        }
      }, 200); // Increased timeout for more reliable scrolling
    }
  }, [selectedConversation]);

  // Scroll to bottom of conversation when new message is added
  useEffect(() => {
    if (justSentRecording && autoScrollEnabled) {
      console.log("New recording added, scrolling to bottom");

      // Add a longer delay to ensure the DOM has updated
      setTimeout(() => {
        scrollToBottom();
      }, 500); // Increased timeout for more reliable scrolling
    }
  }, [justSentRecording, selectedConversationData?.transcriptions.length, autoScrollEnabled]);

  // This effect tracks when a transcription is added and ensures the view switches
  useEffect(() => {
    if (justSentRecording && selectedConversationData) {
      // Force switch to conversation view after processing
      setShowRecordingInterface(false);

      // Add a delay before scrolling to ensure the DOM has updated
      setTimeout(() => {
        if (autoScrollEnabled) {
          scrollToBottom();
        }
      }, 500); // Increased timeout for more reliable scrolling
    }
  }, [justSentRecording, selectedConversationData, autoScrollEnabled]);

  // Focus textarea when editing starts
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  // When a conversation is selected, show the transcription view
  useEffect(() => {
    if (selectedConversation && !isRecording) {
      setShowRecordingInterface(false);
    }
  }, [selectedConversation, isRecording]);

  // When recording is started, show the recording interface
  useEffect(() => {
    if (isRecording) {
      setShowRecordingInterface(true);
    }
  }, [isRecording]);

  // When forceShowTranscription is true, ensure we're showing the transcription view
  useEffect(() => {
    if (forceShowTranscription && selectedConversationData) {
      // Force switch to conversation view
      setShowRecordingInterface(false);

      // Reset the flag
      setForceShowTranscription(false);

      // Scroll to bottom
      setTimeout(() => {
        if (autoScrollEnabled) {
          scrollToBottom();
        }
      }, 500); // Increased timeout for more reliable scrolling
    }
  }, [forceShowTranscription, selectedConversationData, autoScrollEnabled]);

  // Setup scroll event listener to detect when user manually scrolls
  useEffect(() => {
    const container = contentContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (!container) return;

      const isAtBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 200; // Increased threshold for better detection

      // Only update if there's a change to prevent unnecessary renders
      if (isAtBottom !== autoScrollEnabled) {
        setAutoScrollEnabled(isAtBottom);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content container */}
      <div
        ref={contentContainerRef}
        className={cn(
          "flex-1 overflow-y-auto",
          theme === "dark"
            ? "bg-gradient-to-b from-[#1A1A1A] to-[#222222]"
            : "bg-gradient-to-b from-gray-50 to-white"
        )}
      >
        <div className="p-2 sm:p-4 md:p-6">
          <div className="max-w-4xl mx-auto w-full">
            {!selectedConversation || showRecordingInterface ? (
              <>
                <div className="mb-4 sm:mb-8">
                  <h1 className="text-xl sm:text-3xl font-bold mb-2 sm:mb-4 text-TT-purple">
                    ML-Powered Speech Recognition
                  </h1>
                  <p
                    className={cn(
                      "text-sm sm:text-base",
                      theme === "dark" ? "text-TT-purple-tint1" : "text-TT-purple-shade"
                    )}
                  >
                    Record your voice and convert it to text instantly. Follow the steps below to
                    get started.
                  </p>
                </div>

                <Card
                  className={cn(
                    "mb-4 sm:mb-8 p-4 sm:p-8 backdrop-blur-sm shadow-lg shadow-TT-purple/5",
                    "transition-all duration-300 ease-in-out transform",
                    "hover:scale-[1.02] hover:shadow-xl hover:shadow-TT-purple/10",
                    "hover:-translate-y-1 hover:backdrop-blur-md",
                    theme === "dark"
                      ? "bg-[#222222]/80 border-TT-purple/30 hover:bg-[#222222]/90 hover:border-TT-purple/50"
                      : "bg-white/80 border-TT-purple-shade/30 hover:bg-white/90 hover:border-TT-purple-shade/50"
                  )}
                >
                  <h2 className="text-lg sm:text-xl font-semibold mb-4 sm:mb-6 text-TT-purple">
                    {isProcessing ? "Processing..." : ""}
                  </h2>

                  <div className="mb-4">
                    <AudioRecorderWithVisualizer
                      className="mb-4"
                      onRecordingComplete={handleRecordingComplete}
                    />
                  </div>

                  {isProcessing && (
                    <div
                      className={cn(
                        "mt-4 sm:mt-6 p-3 sm:p-4 rounded-md",
                        theme === "dark"
                          ? "border-TT-purple-shade/50 bg-TT-purple-shade/20"
                          : "border-TT-purple-shade/30 bg-TT-purple-shade/10"
                      )}
                    >
                      <div className="flex items-center">
                        <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 mr-2 sm:mr-3 animate-spin text-TT-purple" />
                        <p className="text-sm sm:text-base font-medium text-TT-purple">
                          Sending to API and processing your audio...
                        </p>
                      </div>
                    </div>
                  )}
                </Card>
              </>
            ) : selectedConversation && selectedConversationData ? (
              <div className="flex flex-col">
                {/* Display transcriptions grouped by date */}
                <div className="mb-4 sm:mb-6">
                  {groupTranscriptionsByDate(selectedConversationData.transcriptions).map(
                    (group) => (
                      <div key={group.date} className="mb-6 sm:mb-8">
                        <div className="flex items-center gap-2 px-2 mb-3 sm:mb-4">
                          <div
                            className={cn(
                              "h-px grow",
                              theme === "dark" ? "bg-TT-purple-shade/40" : "bg-TT-purple-shade/20"
                            )}
                          ></div>
                          <div
                            className={cn(
                              "text-xs font-medium px-2 sm:px-3 py-1 sm:py-1.5 rounded-full flex items-center shadow-md shadow-TT-purple-shade/20",
                              theme === "dark"
                                ? "text-white bg-TT-purple-shade/60"
                                : "text-TT-purple bg-TT-purple-shade/20"
                            )}
                          >
                            <Clock className="h-3 w-3 mr-1 text-TT-purple-tint1" />
                            {group.date}
                          </div>
                          <div
                            className={cn(
                              "h-px grow",
                              theme === "dark" ? "bg-TT-purple-shade/40" : "bg-TT-purple-shade/20"
                            )}
                          ></div>
                        </div>

                        <div className="space-y-3 sm:space-y-4">
                          {group.items.map((transcription, index) => (
                            <Card
                              key={transcription.id}
                              className={cn(
                                "p-3 sm:p-5 backdrop-blur-sm border-l-4 shadow-lg shadow-TT-purple/5 transition-all duration-200 hover:shadow-TT-purple/10",
                                theme === "dark"
                                  ? "bg-[#222222]/80 border-y border-r border-TT-purple-shade/30"
                                  : "bg-white/80 border-y border-r border-TT-purple-shade/20",
                                index % 2 === 0 ? "border-l-TT-purple-accent" : "border-l-TT-blue",
                                justSentRecording &&
                                  index === group.items.length - 1 &&
                                  group ===
                                    groupTranscriptionsByDate(
                                      selectedConversationData.transcriptions
                                    )[
                                      groupTranscriptionsByDate(
                                        selectedConversationData.transcriptions
                                      ).length - 1
                                    ]
                                  ? "ring-2 ring-TT-purple/30 bg-TT-purple-shade/10 animate-pulse"
                                  : ""
                              )}
                            >
                              <div className="flex justify-between items-center mb-2 sm:mb-3">
                                <div className="flex items-center gap-1 sm:gap-2">
                                  <MessageSquare className="h-3 w-3 sm:h-4 sm:w-4 text-TT-purple" />
                                  <p className="text-xs sm:text-sm font-medium text-TT-purple-tint1">
                                    {formatTime(transcription.date)}
                                  </p>
                                  {justSentRecording &&
                                    index === group.items.length - 1 &&
                                    group ===
                                      groupTranscriptionsByDate(
                                        selectedConversationData.transcriptions
                                      )[
                                        groupTranscriptionsByDate(
                                          selectedConversationData.transcriptions
                                        ).length - 1
                                      ] && (
                                      <span className="text-xs bg-TT-purple-accent/20 text-TT-purple-accent px-1.5 sm:px-2 py-0.5 rounded-full">
                                        New
                                      </span>
                                    )}
                                </div>
                                <div className="flex space-x-1 sm:space-x-2">
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => copyToClipboard(transcription.text)}
                                          className="h-8 w-8 hover:bg-TT-blue-shade/20 text-TT-blue"
                                        >
                                          <Copy className="h-3 w-3 sm:h-4 sm:w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Copy to clipboard</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>

                                  {isEditing === transcription.id ? (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={saveTranscription}
                                            className="h-8 w-8 hover:bg-TT-green-shade/20 text-TT-green"
                                          >
                                            <Save className="h-3 w-3 sm:h-4 sm:w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Save changes</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setIsEditing(transcription.id)}
                                            className="h-8 w-8 hover:bg-TT-yellow-shade/20 text-TT-yellow"
                                          >
                                            <Edit className="h-3 w-3 sm:h-4 sm:w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Edit transcription</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}

                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 hover:bg-TT-red-shade/20 text-TT-red"
                                        >
                                          <Trash className="h-3 w-3 sm:h-4 sm:w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Delete transcription</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              </div>

                              {/* Audio preview */}
                              {transcription.audioBlob && (
                                <div
                                  className={cn(
                                    "mb-2 sm:mb-3 rounded-md border backdrop-blur-sm",
                                    theme === "dark"
                                      ? "border-TT-purple-shade/50 bg-[#1A1A1A]/90"
                                      : "border-TT-purple-shade/20 bg-white/90"
                                  )}
                                >
                                  <div className="flex items-center gap-1 sm:gap-2 p-2 sm:p-3">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        const audio = document.getElementById(
                                          `audio-${transcription.id}`
                                        ) as HTMLAudioElement;
                                        if (audio.paused) {
                                          audio.play();
                                        } else {
                                          audio.pause();
                                        }
                                      }}
                                      className={cn(
                                        "h-7 w-7 sm:h-8 sm:w-8 p-0 flex items-center justify-center",
                                        "text-TT-purple hover:text-TT-purple-accent hover:bg-TT-purple/10"
                                      )}
                                    >
                                      <Play className="h-3 w-3 sm:h-4 sm:w-4" />
                                    </Button>
                                    <div className="flex-1">
                                      <audio
                                        id={`audio-${transcription.id}`}
                                        className={cn(
                                          "w-full",
                                          theme === "dark"
                                            ? "[&::-webkit-media-controls-panel]:bg-[#1A1A1A]/90"
                                            : "[&::-webkit-media-controls-panel]:bg-white/90",
                                          "[&::-webkit-media-controls-play-button]:hidden",
                                          "[&::-webkit-media-controls-current-time-display]:text-TT-purple-tint1",
                                          "[&::-webkit-media-controls-time-remaining-display]:text-TT-purple-tint1",
                                          "[&::-webkit-media-controls-timeline]:accent-TT-purple"
                                        )}
                                        src={
                                          transcription.audioBlob
                                            ? URL.createObjectURL(transcription.audioBlob)
                                            : undefined
                                        }
                                        controls
                                        ref={audioElementRef}
                                        style={{ height: "32px" }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}

                              {isEditing === transcription.id ? (
                                <textarea
                                  ref={textareaRef}
                                  className={cn(
                                    "w-full min-h-[80px] sm:min-h-[100px] p-2 sm:p-3 rounded-md text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-TT-purple",
                                    theme === "dark"
                                      ? "bg-[#1A1A1A] text-white border-TT-purple-shade/50"
                                      : "bg-white text-gray-900 border-TT-purple-shade/20"
                                  )}
                                  defaultValue={transcription.text}
                                ></textarea>
                              ) : (
                                <div
                                  className={cn(
                                    "p-3 sm:p-4 rounded-lg min-h-[60px] relative group transition-all duration-200",
                                    theme === "dark"
                                      ? "bg-[#1E1E1E] text-white border-[#2A2A2A]"
                                      : "bg-gray-50 text-gray-900 border-gray-200",
                                    "border shadow-[inset_1px_1px_0px_rgba(0,0,0,0.1),_inset_-1px_-1px_0px_rgba(255,255,255,0.05)]"
                                  )}
                                >
                                  <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-TT-purple/5 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none"></div>

                                  <div className="flex items-center gap-2 mb-1.5 sm:mb-2.5">
                                    <div className="h-1.5 w-1.5 rounded-full bg-TT-purple-accent opacity-80"></div>
                                    <div
                                      className={cn(
                                        "text-xs opacity-80 font-medium tracking-wide",
                                        theme === "dark" ? "text-TT-purple-tint1" : "text-TT-purple"
                                      )}
                                    >
                                      Transcription
                                    </div>
                                  </div>

                                  <div
                                    className={cn(
                                      "text-sm sm:text-base leading-relaxed",
                                      theme === "dark" ? "text-TT-purple-tint2" : "text-gray-700"
                                    )}
                                  >
                                    {transcription.text}
                                  </div>

                                  <div
                                    className={cn(
                                      "text-right text-xs mt-2 sm:mt-3 opacity-60 font-mono",
                                      theme === "dark" ? "text-TT-purple-shade" : "text-gray-500"
                                    )}
                                  >
                                    {transcription.text.split(/\s+/).filter(Boolean).length} words
                                  </div>
                                </div>
                              )}
                            </Card>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>

                {/* Add new recording button at bottom of conversation with improved styling */}
                <div
                  className={cn(
                    "py-6 sm:py-10 border-2 border-dashed rounded-lg transition-colors flex justify-center mb-24 sm:mb-52 mt-4 sm:mt-8 relative",
                    theme === "dark"
                      ? "border-TT-purple/40 bg-gradient-to-r from-[#1A1A1A] to-[#222222] hover:from-[#222222] hover:to-[#1A1A1A]"
                      : "border-TT-purple-shade/40 bg-gradient-to-r from-gray-50 to-white hover:from-white hover:to-gray-50"
                  )}
                  ref={conversationEndRef}
                >
                  <Button
                    onClick={startNewRecording}
                    variant="default"
                    size="lg"
                    className="flex items-center gap-2 sm:gap-3 px-4 sm:px-8 py-2 sm:py-7 bg-gradient-to-r from-TT-purple-accent to-TT-purple-accent hover:from-TT-purple hover:to-TT-purple-accent text-white transition-all duration-300 font-medium shadow-md shadow-TT-purple/20 hover:shadow-lg hover:shadow-TT-purple/30"
                  >
                    <Mic className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                    <span className="text-sm sm:text-base text-white">
                      {hasRecordedBefore ? "Record Another Message" : "Record New Message"}
                    </span>
                  </Button>

                  {/* Fixed floating mic button with proper positioning */}
                  <div className="absolute -right-3 -top-3 z-20">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            onClick={startNewRecording}
                            size="sm"
                            variant="ghost"
                            className={cn(
                              "h-12 w-12 sm:h-14 sm:w-14 rounded-full shadow-lg shadow-TT-purple/20",
                              "!bg-TT-purple-accent hover:!bg-TT-purple",
                              "transition-all duration-200 ease-in-out",
                              "flex items-center justify-center relative",
                              theme === "dark"
                                ? "border-2 border-[#1A1A1A]"
                                : "border-2 border-white"
                            )}
                            style={{ backgroundColor: "#7C68FA" }}
                          >
                            {/* Pulse animation */}
                            <span className="absolute inset-0 bg-TT-purple-tint1/20 opacity-0 animate-pulse rounded-full"></span>
                            <Mic className="h-5 w-5 sm:h-6 sm:w-6 text-white relative z-10" />

                            {/* Notification dot with improved positioning */}
                            {hasRecordedBefore && (
                              <span
                                className={cn(
                                  "absolute -top-1 -right-1 h-5 w-5 sm:h-6 sm:w-6 bg-TT-red-accent rounded-full flex items-center justify-center shadow-md",
                                  theme === "dark"
                                    ? "border border-[#1A1A1A]"
                                    : "border border-white"
                                )}
                              >
                                <span className="text-xs text-white font-bold">+</span>
                              </span>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <div className="flex items-center gap-2">
                            <Mic className="h-4 w-4 text-TT-purple-accent" />
                            Record new message
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>

                {/* Extra padding div to ensure there's room to scroll */}
                <div className="h-16 sm:h-32"></div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
