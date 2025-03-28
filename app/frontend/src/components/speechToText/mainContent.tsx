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
// import { toast } from "@/hooks/use-toast";
import { AudioRecorderWithVisualizer } from "@/src/components/speechToText/AudioRecorderWithVisualizer";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { sendAudioRecording } from "./lib/apiClient";

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
}

export function MainContent({
  conversations,
  selectedConversation,
  onNewTranscription,
  isRecording,
  setIsRecording,
}: MainContentProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [showRecordingInterface, setShowRecordingInterface] = useState(true);
  const [justSentRecording, setJustSentRecording] = useState(false);
  const [hasRecordedBefore, setHasRecordedBefore] = useState(false);
  const [forceShowTranscription, setForceShowTranscription] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const contentContainerRef = useRef<HTMLDivElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const selectedConversationData = selectedConversation
    ? conversations.find((c) => c.id === selectedConversation)
    : null;

  // Scroll to position helper
  const scrollToPosition = (
    top: number,
    behavior: ScrollBehavior = "smooth"
  ) => {
    if (contentContainerRef.current) {
      contentContainerRef.current.scrollTo({
        top,
        behavior,
      });
    }
  };

  // Scroll to bottom helper
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (conversationEndRef.current && contentContainerRef.current) {
      conversationEndRef.current.scrollIntoView({
        behavior,
        block: "end",
      });
    }
  };

  // Handle recording complete
  const handleRecordingComplete = async (recordedBlob: Blob) => {
    console.log(
      "Recording completed, blob type:",
      recordedBlob.type,
      "size:",
      recordedBlob.size
    );
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
      const data = await sendAudioRecording(audioBlob);

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
      }, 300);

      console.log("Transcription successful:", transcriptionText);
    } catch (error) {
      console.error("Error processing audio:", error);
      alert(
        `Transcription Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
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

  // Toggle between recording interface and transcription view
  const toggleView = () => {
    setShowRecordingInterface(!showRecordingInterface);
    if (!showRecordingInterface) {
      setJustSentRecording(false);
    }
  };

  // Start a new recording
  const startNewRecording = () => {
    setIsRecording(true);
    setShowRecordingInterface(true);
    setJustSentRecording(false);
    setHasRecordedBefore(true);
    setForceShowTranscription(false);
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
      // Reset scroll position to top first
      if (contentContainerRef.current) {
        contentContainerRef.current.scrollTop = 0;
      }

      // Slight delay to ensure the DOM is ready
      setTimeout(() => {
        if (selectedConversationData.transcriptions.length > 0) {
          scrollToBottom("auto");
        }
      }, 100);
    }
  }, [selectedConversation]);

  // Scroll to bottom of conversation when new message is added
  useEffect(() => {
    if (justSentRecording && autoScrollEnabled) {
      // Add a delay to ensure the DOM has updated
      setTimeout(() => {
        scrollToBottom();
      }, 300);
    }
  }, [
    justSentRecording,
    selectedConversationData?.transcriptions.length,
    autoScrollEnabled,
  ]);

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
      }, 300);
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
      }, 300);
    }
  }, [forceShowTranscription, selectedConversationData, autoScrollEnabled]);

  // Setup scroll event listener to detect when user manually scrolls
  useEffect(() => {
    const container = contentContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (!container) return;

      const isAtBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        100;

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
    <div className="h-full w-full flex flex-col bg-[#1A1A1A] relative">
      {/* Main container with fixed height and scrolling */}
      <div className="h-full flex flex-col ">
        {/* REMOVED the fixed header - Header is now handled in parent component */}

        {/* Scrollable content container - with proper z-index to prevent overlapping with header */}
        <div
          ref={contentContainerRef}
          className="flex-1 overflow-y-auto relative z-0"
        >
          <div className="p-6">
            <div className="max-w-4xl mx-auto w-full">
              {!selectedConversation || showRecordingInterface ? (
                <>
                  <div className="mb-8">
                    <h1 className="text-3xl font-bold mb-4 text-TT-purple">
                      Record Your Speech
                    </h1>
                    <p className="text-muted-foreground dark:text-gray-300">
                      Record your voice and convert it to text instantly. Follow
                      the steps below to get started.
                    </p>
                  </div>

                  <Card className="mb-8 p-8 bg-background/50 backdrop-blur-sm border-TT-purple-shade dark:bg-[#2A2A2A]/50 dark:border-TT-purple/20">
                    <h2 className="text-xl font-semibold mb-6 text-TT-purple">
                      {isProcessing ? "Processing..." : ""}
                    </h2>

                    <div className="mb-4">
                      <AudioRecorderWithVisualizer
                        className="mb-4"
                        onRecordingComplete={handleRecordingComplete}
                      />
                    </div>

                    {isProcessing && (
                      <div className="mt-6 p-4 border border-TT-purple-shade rounded-md bg-TT-purple-shade/20">
                        <div className="flex items-center">
                          <Loader2 className="h-5 w-5 mr-3 animate-spin text-TT-purple" />
                          <p className="font-medium text-TT-purple">
                            Sending to API and processing your audio...
                          </p>
                        </div>
                      </div>
                    )}
                  </Card>
                </>
              ) : selectedConversation && selectedConversationData ? (
                <div className="flex flex-col">
                  <Card className="p-6 bg-background/50 backdrop-blur-sm border-TT-blue-shade dark:bg-[#2A2A2A]/50 dark:border-TT-purple/20 flex-none mb-6">
                    <div className="flex justify-between items-center">
                      <h2 className="text-xl font-semibold text-TT-blue dark:text-TT-blue">
                        {selectedConversationData.title}
                      </h2>
                      <div className="text-sm text-TT-blue dark:text-TT-blue">
                        {selectedConversationData.transcriptions.length}{" "}
                        {selectedConversationData.transcriptions.length === 1
                          ? "message"
                          : "messages"}
                      </div>
                    </div>
                  </Card>

                  {/* Display transcriptions grouped by date */}
                  <div className="mb-6">
                    {groupTranscriptionsByDate(
                      selectedConversationData.transcriptions
                    ).map((group) => (
                      <div key={group.date} className="mb-8">
                        <div className="flex items-center gap-2 px-2 mb-4">
                          <div className="h-px bg-TT-slate-shade flex-grow dark:bg-gray-600"></div>
                          <div className="text-xs font-medium text-TT-slate bg-TT-slate-shade px-2 py-1 rounded-full flex items-center dark:bg-gray-700 dark:text-gray-300">
                            <Clock className="h-3 w-3 mr-1 text-TT-slate dark:text-gray-300" />
                            {group.date}
                          </div>
                          <div className="h-px bg-TT-slate-shade flex-grow dark:bg-gray-600"></div>
                        </div>

                        <div className="space-y-4">
                          {group.items.map((transcription, index) => (
                            <Card
                              key={transcription.id}
                              className={cn(
                                "p-5 bg-background/50 backdrop-blur-sm border-l-4 dark:bg-[#2A2A2A]/70",
                                index % 2 === 0
                                  ? "border-l-TT-purple"
                                  : "border-l-TT-blue",
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
                                  ? "ring-2 ring-TT-purple/30 animate-pulse"
                                  : ""
                              )}
                            >
                              <div className="flex justify-between items-center mb-3">
                                <div className="flex items-center gap-2">
                                  <MessageSquare className="h-4 w-4 text-TT-purple" />
                                  <p className="text-sm font-medium dark:text-gray-200">
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
                                      <span className="text-xs bg-TT-purple-shade text-TT-purple px-2 py-0.5 rounded-full">
                                        New
                                      </span>
                                    )}
                                </div>
                                <div className="flex space-x-2">
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() =>
                                            copyToClipboard(transcription.text)
                                          }
                                          className="hover:bg-TT-blue-shade/20 text-TT-blue"
                                        >
                                          <Copy className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Copy to clipboard
                                      </TooltipContent>
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
                                            className="hover:bg-TT-green-shade/20 text-TT-green"
                                          >
                                            <Save className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Save changes
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() =>
                                              setIsEditing(transcription.id)
                                            }
                                            className="hover:bg-TT-yellow-shade/20 text-TT-yellow"
                                          >
                                            <Edit className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          Edit transcription
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}

                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="hover:bg-TT-red-shade/20 text-TT-red"
                                        >
                                          <Trash className="h-4 w-4" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        Delete transcription
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              </div>

                              {/* Audio preview */}
                              {transcription.audioBlob && (
                                <div className="mb-3 rounded-md border bg-white/50 dark:bg-[#222222]/50 backdrop-blur-sm border-border dark:border-TT-purple/20">
                                  <div className="flex items-center gap-2 p-3">
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
                                      className="h-8 w-8 p-0 flex items-center justify-center text-TT-purple hover:text-TT-purple-shade hover:bg-TT-purple/10 dark:text-purple-400 dark:hover:text-purple-300 dark:hover:bg-purple-900/20"
                                    >
                                      <Play className="h-4 w-4" />
                                    </Button>
                                    <div className="flex-1">
                                      <audio
                                        id={`audio-${transcription.id}`}
                                        className="w-full 
                                          [&::-webkit-media-controls-panel]:bg-white/50 
                                          [&::-webkit-media-controls-panel]:dark:bg-[#222222]/50 
                                          [&::-webkit-media-controls-play-button]:hidden 
                                          [&::-webkit-media-controls-current-time-display]:text-gray-700 
                                          [&::-webkit-media-controls-current-time-display]:dark:text-gray-300
                                          [&::-webkit-media-controls-time-remaining-display]:text-gray-700 
                                          [&::-webkit-media-controls-time-remaining-display]:dark:text-gray-300
                                          [&::-webkit-media-controls-timeline]:accent-TT-purple"
                                        src={
                                          transcription.audioBlob
                                            ? URL.createObjectURL(
                                                transcription.audioBlob
                                              )
                                            : undefined
                                        }
                                        controls
                                        style={{ height: "32px" }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div>
                                {isEditing === transcription.id ? (
                                  <textarea
                                    ref={textareaRef}
                                    className="w-full min-h-[100px] p-3 border border-input rounded-md bg-white dark:bg-[#222222] dark:text-white focus:outline-none focus:ring-2 focus:ring-TT-purple"
                                    defaultValue={transcription.text}
                                  ></textarea>
                                ) : (
                                  <div className="p-3 rounded-md bg-white dark:bg-[#222222] dark:text-white min-h-[60px] border border-muted">
                                    {transcription.text}
                                  </div>
                                )}
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add new recording button at bottom of conversation */}
                  <div
                    className="py-10 border-2 border-dashed border-TT-purple/60 rounded-lg bg-[#1A1A1A] hover:bg-[#252525] transition-colors flex justify-center mb-20 mt-8 relative"
                    ref={conversationEndRef}
                  >
                    <Button
                      onClick={startNewRecording}
                      variant="default"
                      size="lg"
                      className="flex items-center gap-3 px-6 py-6 bg-gradient-to-r from-TT-purple-accent to-TT-purple hover:from-TT-purple-shade hover:to-TT-purple-accent text-white transition-all duration-300 font-medium"
                    >
                      <Mic className="h-5 w-5 text-white" />
                      <span>
                        {hasRecordedBefore
                          ? "Record Another Audio Message"
                          : "Record New Audio Message"}
                      </span>
                    </Button>

                    {/* Add the floating mic button inside the dashed container */}
                    <div className="absolute -right-6 -top-6">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              onClick={startNewRecording}
                              size="sm"
                              className={cn(
                                "h-12 w-12 rounded-full shadow-lg",
                                "bg-TT-purple-accent hover:bg-TT-purple-shade",
                                "transition-all duration-200 ease-in-out",
                                "flex items-center justify-center relative"
                              )}
                            >
                              <Mic className="h-5 w-5 text-white" />
                              {hasRecordedBefore && (
                                <span className="absolute -top-1 -right-1 h-5 w-5 bg-TT-red-accent rounded-full flex items-center justify-center">
                                  <span className="text-xs text-white font-bold">
                                    +
                                  </span>
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
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
