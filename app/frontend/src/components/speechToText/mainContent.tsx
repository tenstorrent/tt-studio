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
  modelID: string;
}

export function MainContent({
  conversations,
  selectedConversation,
  onNewTranscription,
  isRecording,
  setIsRecording,
  modelID,
}: MainContentProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [showRecordingInterface, setShowRecordingInterface] = useState(true);
  const [justSentRecording, setJustSentRecording] = useState(false);
  const [hasRecordedBefore, setHasRecordedBefore] = useState(false);
  const [forceShowTranscription, setForceShowTranscription] = useState(false);

  const conversationEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const selectedConversationData = selectedConversation
    ? conversations.find((c) => c.id === selectedConversation)
    : null;

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

    // No need to create a preview URL in MainContent
    // Let the AudioRecorderWithVisualizer handle the preview

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
        if (conversationEndRef.current) {
          conversationEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }, 300);

      console.log("Transcription successful:", transcriptionText);
      // toast({
      //   title: "Transcription Complete",
      //   description: "Your audio has been successfully transcribed.",
      // });
    } catch (error) {
      console.error("Error processing audio:", error);
      alert(
        `Transcription Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      // toast({
      //   title: "Transcription Error",
      //   description:
      //     "There was an error processing your audio. Please try again.",
      //   variant: "destructive",
      // });
    } finally {
      setIsProcessing(false);
    }
  };

  // Copy transcription to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // toast({
    //   title: "Copied to clipboard",
    //   description: "The transcription has been copied to your clipboard",
    // });
  };

  // Save edited transcription
  const saveTranscription = () => {
    setIsEditing(null);
    // In a real app, you would update the transcription in your state/database here
    // toast({
    //   title: "Changes saved",
    //   description: "Your edits have been saved successfully",
    // });
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

  // Scroll to bottom of conversation when new message is added
  useEffect(() => {
    if (justSentRecording && conversationEndRef.current) {
      conversationEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [justSentRecording, selectedConversationData?.transcriptions.length]);

  // This effect tracks when a transcription is added and ensures the view switches
  useEffect(() => {
    if (justSentRecording && selectedConversationData) {
      // Force switch to conversation view after processing
      setShowRecordingInterface(false);

      // Add a delay before scrolling to ensure the DOM has updated
      setTimeout(() => {
        if (conversationEndRef.current) {
          conversationEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
      }, 300);
    }
  }, [justSentRecording, selectedConversationData]);

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
    }
  }, [forceShowTranscription, selectedConversationData]);

  return (
    <div className="flex-1 p-6 overflow-auto">
      <div className="max-w-4xl mx-auto">
        {/* Toggle button between recording and transcription view */}
        {selectedConversation && (
          <div className="mb-4 flex justify-end">
            <Button
              variant="outline"
              size="lg"
              onClick={toggleView}
              className="text-base px-6"
            >
              {showRecordingInterface ? (
                <>
                  <MessageSquare className="h-5 w-5 mr-2" />
                  View Conversation
                </>
              ) : (
                <>
                  <Mic className="h-5 w-5 mr-2" />
                  Record New Audio
                </>
              )}
            </Button>
          </div>
        )}

        {!selectedConversation || showRecordingInterface ? (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-4">Record Your Speech</h1>
              <p className="text-muted-foreground">
                Record your voice and convert it to text instantly. Follow the
                steps below to get started.
              </p>
            </div>

            <Card className="mb-8 p-8 bg-background/50 backdrop-blur-sm">
              <h2 className="text-xl font-semibold mb-6">
                {isProcessing ? "Processing..." : "Record Your Speech"}
              </h2>

              <div className="mb-4">
                <AudioRecorderWithVisualizer
                  className="mb-4"
                  onRecordingComplete={handleRecordingComplete}
                />
              </div>

              {isProcessing && (
                <div className="mt-6 p-4 border border-border rounded-md bg-muted/50">
                  <div className="flex items-center">
                    <Loader2 className="h-5 w-5 mr-3 animate-spin" />
                    <p className="font-medium">
                      Sending to API and processing your audio...
                    </p>
                  </div>
                </div>
              )}

              {/* Remove this section - only show audio preview in the AudioRecorderWithVisualizer
              {audioBlob && !isProcessing && (
                <div className="mt-6">
                  <p className="font-medium mb-3">Audio Preview:</p>
                  <audio
                    ref={audioElementRef}
                    className="w-full"
                    src={audioUrl || undefined}
                    controls
                  />
                  <div className="mt-4 flex justify-end">
                    <Button
                      onClick={() => processAudioWithAPI(audioBlob)}
                      className="flex items-center gap-2"
                    >
                      <Send className="h-5 w-5" />
                      Send Recording
                    </Button>
                  </div>
                </div>
              )} */}
            </Card>
          </>
        ) : selectedConversation && selectedConversationData ? (
          <div className="space-y-6">
            <Card className="p-6 bg-background/50 backdrop-blur-sm">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">
                  {selectedConversationData.title}
                </h2>
                <div className="text-sm text-muted-foreground">
                  {selectedConversationData.transcriptions.length}{" "}
                  {selectedConversationData.transcriptions.length === 1
                    ? "message"
                    : "messages"}
                </div>
              </div>
            </Card>

            {/* Display transcriptions grouped by date */}
            {groupTranscriptionsByDate(
              selectedConversationData.transcriptions
            ).map((group) => (
              <div key={group.date} className="space-y-4">
                <div className="flex items-center gap-2 px-2">
                  <div className="h-px bg-border flex-grow"></div>
                  <div className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full flex items-center">
                    <Clock className="h-3 w-3 mr-1" />
                    {group.date}
                  </div>
                  <div className="h-px bg-border flex-grow"></div>
                </div>

                {group.items.map((transcription, index) => (
                  <Card
                    key={transcription.id}
                    className={cn(
                      "p-5 bg-background/50 backdrop-blur-sm border-l-4",
                      index % 2 === 0
                        ? "border-l-purple-500"
                        : "border-l-blue-500",
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
                        ? "ring-2 ring-purple-500/50 animate-pulse"
                        : ""
                    )}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">
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
                            <span className="text-xs bg-purple-500/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full">
                              New
                            </span>
                          )}
                      </div>
                      <div className="flex space-x-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyToClipboard(transcription.text)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        {isEditing === transcription.id ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={saveTranscription}
                          >
                            <Save className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsEditing(transcription.id)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon">
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Audio preview */}
                    {transcription.audioBlob && (
                      <div className="mb-3 bg-muted/30 p-3 rounded-md">
                        <audio
                          className="w-full"
                          src={
                            transcription.audioBlob
                              ? URL.createObjectURL(transcription.audioBlob)
                              : undefined
                          }
                          controls
                        />
                      </div>
                    )}

                    <div>
                      {isEditing === transcription.id ? (
                        <textarea
                          ref={textareaRef}
                          className="w-full min-h-[100px] p-3 border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                          defaultValue={transcription.text}
                        ></textarea>
                      ) : (
                        <div className="p-3 rounded-md bg-muted/10 min-h-[60px]">
                          {transcription.text}
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            ))}

            {/* Add new recording button at bottom of conversation */}
            <div
              className="flex justify-center items-center py-8 mt-4 border-2 border-dashed border-border rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors"
              ref={conversationEndRef}
            >
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={startNewRecording}
                      variant="default"
                      size="lg"
                      className="flex items-center gap-2 px-6"
                    >
                      <Mic
                        className={cn(
                          "h-5 w-5",
                          hasRecordedBefore && "text-red-500"
                        )}
                      />
                      {/* <span className="font-medium">
                        {hasRecordedBefore
                          ? "Record Another Audio Message"
                          : "Record New Audio Message"}
                      </span> */}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {hasRecordedBefore
                      ? "Continue the conversation with another recording"
                      : "Start recording your first message"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        ) : null}
      </div>

      {/* Floating record button - only show when in transcription view */}
      {selectedConversation && !showRecordingInterface && (
        <div className="fixed bottom-8 right-8">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={startNewRecording}
                  size="lg"
                  className={cn(
                    "h-16 w-16 rounded-full shadow-lg",
                    "bg-purple-600 hover:bg-purple-700",
                    "transition-all duration-200 ease-in-out",
                    "flex items-center justify-center"
                  )}
                >
                  <Mic
                    className="h-7 w-7 text-white"
                    style={{ color: "white" }}
                  />
                  {hasRecordedBefore && (
                    <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {hasRecordedBefore
                  ? "Record another message"
                  : "Start recording"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}
