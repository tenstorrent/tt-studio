// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import type React from "react";
import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "../ui/button";
import { Paperclip, Send, X, File, Plus } from "lucide-react";
import { VoiceInput } from "./VoiceInput";
import { FileUpload } from "../ui/file-upload";
import { isImageFile, validateFile, encodeFile, isTextFile } from "./fileUtils";
import { cn } from "../../lib/utils";
import type { FileData } from "./types";
import { customToast } from "../CustomToaster";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

interface InputAreaProps {
  textInput: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  handleInference: (input?: string, files?: FileData[]) => void;
  isStreaming: boolean;
  isListening: boolean;
  setIsListening: (isListening: boolean) => void;
  files?: FileData[];
  setFiles?: React.Dispatch<React.SetStateAction<FileData[]>>;
  isMobileView?: boolean;
  onCreateNewConversation?: () => void;
}

export default function InputArea({
  textInput,
  setTextInput,
  handleInference,
  isStreaming,
  isListening,
  setIsListening,
  files = [],
  setFiles = () => {},
  isMobileView = false,
  onCreateNewConversation,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFileUploadOpen, setIsFileUploadOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showProgressBar, setShowProgressBar] = useState(false);
  const [showErrorIndicator, setShowErrorIndicator] = useState(false);
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [touchFeedback, setTouchFeedback] = useState("");

  useEffect(() => {
    if (textareaRef.current && !isStreaming) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  useEffect(() => {
    if (textareaRef.current) {
      adjustTextareaHeight();
    }
  }, []);

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const maxHeight = isMobileView ? 120 : 200; // Lower max height on mobile
      const scrollHeight = Math.min(
        textareaRef.current.scrollHeight,
        maxHeight
      );
      textareaRef.current.style.height = `${scrollHeight}px`;

      // If content is larger than maxHeight, enable scrolling
      textareaRef.current.style.overflowY =
        textareaRef.current.scrollHeight > maxHeight ? "auto" : "hidden";
    }
  };

  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
    adjustTextareaHeight();
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isStreaming) {
      e.preventDefault();
      if (textInput.trim() !== "" || files.length > 0) {
        handleInference(textInput, files);
      }
    }
  };

  const handleVoiceInput = (transcript: string) => {
    setTextInput((prevText) => prevText + (prevText ? " " : "") + transcript);
    adjustTextareaHeight();
  };

  const handleTouchStart = (message: string) => {
    setTouchFeedback(message);
    // Haptic feedback if available
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  const handleTouchEnd = () => {
    setTimeout(() => setTouchFeedback(""), 500);
  };

  const processFile = useCallback(async (file: File) => {
    try {
      setShowProgressBar(true);

      const validation = validateFile(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const base64 = await encodeFile(file, true);
      if (isImageFile(file)) {
        return {
          type: "image_url" as const,
          image_url: { url: `data:${file.type};base64,${base64}` },
          name: file.name,
        };
      }

      return {
        type: "text" as const,
        text: base64,
        name: file.name,
      };
    } catch (error) {
      console.error("File processing error:", error);
      throw error;
    }
  }, []);

  const handleFileUpload = useCallback(
    async (uploadedFiles: File[]) => {
      try {
        setIsDragging(false);
        setShowProgressBar(true);

        const imageFiles = uploadedFiles.filter(isImageFile);
        const textFiles = uploadedFiles.filter(isTextFile);

        // Handle image files
        if (imageFiles.length > 0) {
          const existingImages = files.filter((f) => f.type === "image_url");
          if (existingImages.length > 0) {
            setPendingImageFile(imageFiles[0]);
            setShowReplaceDialog(true);

            // Process text files if any
            if (textFiles.length > 0) {
              const encodedTextFiles = await Promise.all(
                textFiles.map(processFile)
              );
              setFiles((prevFiles) => [...prevFiles, ...encodedTextFiles]);
              customToast.success(
                `Successfully uploaded ${textFiles.length} text file(s)!`
              );
            }
            return;
          }
          // No existing image, process the first image file
          const encodedImage = await processFile(imageFiles[0]);
          const encodedTextFiles = await Promise.all(
            textFiles.map(processFile)
          );

          setFiles((prevFiles) => [
            ...prevFiles,
            encodedImage,
            ...encodedTextFiles,
          ]);
          customToast.success(
            `Successfully uploaded ${imageFiles.length > 1 ? "1 image (extras ignored)" : "1 image"}${
              textFiles.length > 0
                ? ` and ${textFiles.length} text file(s)`
                : ""
            }!`
          );
        } else if (textFiles.length > 0) {
          // Only text files
          const encodedFiles = await Promise.all(textFiles.map(processFile));
          setFiles((prevFiles) => [...prevFiles, ...encodedFiles]);
          customToast.success(
            `Successfully uploaded ${textFiles.length} text file(s)!`
          );
        }
      } catch (error) {
        console.error("File upload error:", error);
        customToast.error(
          error instanceof Error
            ? error.message
            : "Failed to upload file(s). Please try again."
        );
        setShowErrorIndicator(true);
        setTimeout(() => setShowErrorIndicator(false), 3000);
      } finally {
        setShowProgressBar(false);
        setIsFileUploadOpen(false);
      }
    },
    [files, processFile, setFiles]
  );

  const handleReplaceConfirm = async () => {
    if (pendingImageFile) {
      try {
        const encodedImage = await processFile(pendingImageFile);
        setFiles((prevFiles) => [
          ...prevFiles.filter((f) => f.type !== "image_url"),
          encodedImage,
        ]);
        customToast.success("Image replaced successfully!");
      } catch (error) {
        console.error("Error replacing image:", error);
        customToast.error("Failed to replace image. Please try again.");
      }
      setPendingImageFile(null);
    }
    setShowReplaceDialog(false);
  };

  const handleReplaceCancel = () => {
    setPendingImageFile(null);
    setShowReplaceDialog(false);
  };

  const removeFile = (index: number) => {
    setFiles((prevFiles) => prevFiles.filter((_, i) => i !== index));
    customToast.success("File removed successfully!");
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (_e: React.DragEvent<HTMLDivElement>) => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (files) handleFileUpload(Array.from(files));
  };

  useEffect(() => {
    adjustTextareaHeight();
    window.addEventListener("resize", adjustTextareaHeight);
    return () => window.removeEventListener("resize", adjustTextareaHeight);
  }, [textInput]);

  return (
    <>
      <AlertDialog open={showReplaceDialog} onOpenChange={setShowReplaceDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace Existing Image?</AlertDialogTitle>
            <AlertDialogDescription>
              You can only have one image at a time. Do you want to replace the
              existing image with the new one?
              {pendingImageFile && (
                <div className="mt-2 text-sm">
                  New image: {pendingImageFile.name}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleReplaceCancel}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleReplaceConfirm}>
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Touch feedback notification */}
      {touchFeedback && (
        <div className="fixed top-1/4 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gray-800 text-white text-sm rounded-lg px-4 py-2 z-50 opacity-80">
          {touchFeedback}
        </div>
      )}

      <div className="flex-shrink-0 w-full mt-2">
        <div
          className={cn(
            "relative w-full bg-white dark:bg-[#2A2A2A] rounded-lg p-2 sm:p-4 shadow-lg dark:shadow-2xl border transition-all duration-200",
            isFocused
              ? "border-gray-400/50 dark:border-white/20"
              : "border-gray-200 dark:border-[#7C68FA]/20",
            "overflow-hidden"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-lg font-semibold z-50">
              <div className="bg-white/20 rounded-lg p-8 flex flex-col items-center transition-all duration-300 ease-in-out">
                <Paperclip className="h-12 w-12 mb-4 animate-bounce" />
                <span className="text-2xl animate-pulse">
                  Drop files to upload
                </span>
                <span className="text-sm mt-2">
                  Limited to one image, multiple text files allowed
                </span>
              </div>
            </div>
          )}

          {/* File preview section */}
          {files.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2 mb-2">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center space-x-2 bg-gray-100 dark:bg-gray-800 p-2 rounded-md shadow-sm"
                  >
                    <div className="flex-shrink-0">
                      {file.type === "image_url" ? (
                        <img
                          src={file.image_url?.url || "/placeholder.svg"}
                          alt={file.name}
                          className="w-6 h-6 object-cover rounded"
                        />
                      ) : (
                        <File className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                      )}
                    </div>
                    <span className="text-sm truncate max-w-[150px]">
                      {file.name}
                    </span>
                    <button
                      type="button"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => removeFile(index)}
                      aria-label="Remove file"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 mb-2" />
            </>
          )}

          {/* Main text input area */}
          <textarea
            ref={textareaRef}
            value={textInput}
            onChange={handleTextAreaInput}
            onKeyDown={handleKeyPress}
            placeholder={isMobileView ? "Type message..." : "Enter your prompt"}
            className="w-full bg-transparent text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-white/70 border-none focus:outline-none resize-none font-rmMono text-sm sm:text-base overflow-y-auto py-1"
            disabled={isStreaming}
            rows={1}
            style={{
              minHeight: isMobileView ? "20px" : "24px",
              maxHeight: isMobileView ? "120px" : "200px",
            }}
            aria-label="Chat input"
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          />

          {/* Control buttons */}
          <div className="flex justify-between items-center mt-2">
            <div className="flex gap-1 sm:gap-2 items-center">
              {/* File Upload Button */}
              <div className="relative group">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size={isMobileView ? "sm" : "default"}
                        className="text-gray-600 dark:text-white/70 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 p-1 sm:p-2 rounded-full flex items-center justify-center transition-colors duration-300"
                        onClick={() => setIsFileUploadOpen((prev) => !prev)}
                        aria-label="Attach files"
                        onTouchStart={() => handleTouchStart("Attach files")}
                        onTouchEnd={handleTouchEnd}
                      >
                        <Paperclip
                          className={`${isMobileView ? "h-4 w-4" : "h-5 w-5"}`}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Attach files (1 image max)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {isMobileView && (
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    Attach files
                  </div>
                )}
              </div>

              {/* Voice Input */}
              <div className="relative group">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <VoiceInput
                          onTranscript={handleVoiceInput}
                          isListening={isListening}
                          setIsListening={setIsListening}
                          // isMobileView={isMobileView}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Voice input</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {isMobileView && (
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    {isListening ? "Stop recording" : "Voice input"}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* New Chat button */}
              {onCreateNewConversation && (
                <div className="relative group">
                  <Button
                    onClick={() => {
                      handleTouchStart("Creating new chat");
                      onCreateNewConversation();
                      handleTouchEnd();
                    }}
                    onTouchStart={() => handleTouchStart("Creating new chat")}
                    onTouchEnd={handleTouchEnd}
                    size="sm"
                    className={`
                      bg-transparent border border-[#7C68FA]/50 hover:bg-[#7C68FA]/10 active:bg-[#7C68FA]/20 text-[#7C68FA] 
                      rounded-full flex items-center transition-all duration-200 touch-manipulation
                      ${
                        isMobileView
                          ? "justify-center h-7 w-7 p-0"
                          : "justify-center gap-1.5 px-3 py-1"
                      }
                    `}
                    aria-label="Start a new chat"
                  >
                    <Plus className={isMobileView ? "h-3 w-3" : "h-4 w-4"} />
                    {!isMobileView && <span className="text-xs">New chat</span>}
                  </Button>
                  {isMobileView && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      New chat
                    </div>
                  )}
                </div>
              )}

              {/* Send Button */}
              <div className="relative group">
                <Button
                  onClick={() => {
                    if (
                      (textInput.trim() !== "" || files.length > 0) &&
                      !isStreaming
                    ) {
                      handleTouchStart("Sending message");
                      handleInference(textInput, files);
                      handleTouchEnd();
                    }
                  }}
                  onTouchStart={() => {
                    if (
                      (textInput.trim() !== "" || files.length > 0) &&
                      !isStreaming
                    ) {
                      handleTouchStart("Sending message");
                    }
                  }}
                  onTouchEnd={handleTouchEnd}
                  disabled={
                    isStreaming || (!textInput.trim() && files.length === 0)
                  }
                  className={`
                    bg-[#7C68FA] hover:bg-[#7C68FA]/80 active:bg-[#7C68FA]/90 text-white 
                    ${isMobileView ? "px-2 py-1 text-xs" : "px-4 py-2 text-sm"} 
                    rounded-lg flex items-center gap-1 sm:gap-2 transition-all duration-200 touch-manipulation
                    ${(!textInput.trim() && files.length === 0) || isStreaming ? "opacity-70" : ""}
                  `}
                  aria-label={
                    isMobileView ? "Send message" : "Generate response"
                  }
                >
                  {isMobileView ? (
                    <Send className="h-3 w-3" />
                  ) : (
                    <>
                      Generate
                      <Send className="h-4 w-4" />
                    </>
                  )}
                </Button>
                {isMobileView && (
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                    {isStreaming ? "Generating..." : "Send message"}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Streaming indicator */}
          {isStreaming && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#7C68FA] to-[#7C68FA] animate-pulse-ripple-x" />
            </div>
          )}

          {/* File upload progress indicators */}
          {showProgressBar && (
            <div className="absolute bottom-0 left-0 w-full h-1 bg-green-500 animate-progress" />
          )}
          {showErrorIndicator && (
            <div className="absolute bottom-0 left-0 w-full h-1 bg-red-500 animate-pulse" />
          )}
        </div>

        {/* Notification banner */}
        {showBanner && (
          <div className="w-full mt-2">
            <div
              className={`
                bg-[#1a1625] rounded-lg flex justify-between items-center
                ${isMobileView ? "p-2 text-xs" : "p-3 text-sm"}
              `}
            >
              <div className="text-gray-300">
                {isMobileView
                  ? "LLM's can make mistakes."
                  : "LLM's can make mistakes. Check important infos."}
              </div>
              <button
                className="text-gray-400 hover:text-gray-300 ml-2"
                onClick={() => setShowBanner(false)}
                title="Dismiss"
              >
                <X className={`${isMobileView ? "h-3 w-3" : "h-4 w-4"}`} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* File upload dialog */}
      {isFileUploadOpen && (
        <FileUpload
          onChange={handleFileUpload}
          onClose={() => setIsFileUploadOpen(false)}
        />
      )}
    </>
  );
}
