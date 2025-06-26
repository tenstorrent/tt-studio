// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { useEffect, useRef, useState, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "../ui/button";
import {
  Paperclip,
  Send,
  X,
  File,
  Plus,
  ExternalLink,
  FileText,
  FileIcon,
  Info as InfoIcon,
} from "lucide-react";
import { VoiceInput } from "./VoiceInput";
import { FileUpload } from "../ui/file-upload";
import { isImageFile, validateFile, encodeFile, isTextFile, isPdfFile } from "./fileUtils";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { useNavigate } from "react-router-dom";
import { TypingAnimation } from "../ui/typing-animation";

interface PdfDetectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdfFileName: string;
  onNavigate: () => void;
}

function PdfDetectionDialog({
  open,
  onOpenChange,
  pdfFileName,
  onNavigate,
}: PdfDetectionDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="fixed inset-0 bg-black opacity-75" onClick={() => onOpenChange(false)} />
      <div className="relative max-w-md w-full bg-[#0A0A13] rounded-lg border border-TT-purple-accent shadow-xl z-[101] mx-4">
        <div className="p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-[#1E3A8A] p-2 rounded-full flex-shrink-0">
              <FileText className="h-6 w-6 text-TT-red-accent" />
            </div>
            <h2 className="text-xl font-bold text-blue-100 m-0">PDF Upload Detected</h2>
          </div>
          <div className="space-y-4">
            <p className="text-gray-300 text-base">
              PDFs need to be uploaded to the RAG management page for processing.
            </p>
            {pdfFileName && (
              <div className="bg-[#1F2937] rounded-lg p-3 border border-gray-700">
                <p className="text-sm text-gray-400 mb-1">File detected:</p>
                <div className="flex items-center gap-2 overflow-hidden">
                  <FileIcon className="h-5 w-5 flex-shrink-0 text-red-400" />
                  <span className="text-blue-200 font-medium truncate">{pdfFileName}</span>
                </div>
              </div>
            )}
            <div className="text-sm text-gray-400 flex items-center gap-2">
              <InfoIcon className="h-4 w-4 flex-shrink-0 text-TT-purple-tint2" />
              <span>PDFs require special processing.</span>
            </div>
          </div>
        </div>
        <div className="bg-[#111827] px-5 py-4 rounded-b-lg flex justify-end gap-3">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-md bg-TT-purple-accent border border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onNavigate}
            className="px-4 py-2 rounded-md bg-TT-purple-accent hover:bg-gray-700 text-white font-medium transition-colors flex items-center gap-2"
          >
            Go to RAG Management
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

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
  onStopInference?: () => void;
}

const EXAMPLE_PROMPTS = [
  "How can I help you today?",
  "What would you like to know?",
  "Ask me anything!",
  "I'm here to assist you.",
  "What's on your mind?",
];

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
  onStopInference,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFileUploadOpen, setIsFileUploadOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showProgressBar, setShowProgressBar] = useState(false);
  const [showErrorIndicator, setShowErrorIndicator] = useState(false);
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isTouched, setIsTouched] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [touchFeedback, setTouchFeedback] = useState("");
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [pdfFileName, setPdfFileName] = useState("");
  const navigate = useNavigate();

  // Add a meta viewport setting effect
  useEffect(() => {
    // Ensure proper viewport meta tag settings for mobile
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
      viewportMeta.setAttribute(
        "content",
        "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
      );
    }
  }, []);

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
      // Reset height first to get accurate scrollHeight
      textareaRef.current.style.height = "auto";

      // Set appropriate max heights for mobile vs desktop
      const maxHeight = isMobileView ? 80 : 200;

      // Calculate new height (minimum 36px for mobile to show a line of text)
      const minHeight = isMobileView ? 36 : 24;
      const scrollHeight = Math.min(
        Math.max(textareaRef.current.scrollHeight, minHeight),
        maxHeight
      );

      textareaRef.current.style.height = `${scrollHeight}px`;

      // Only enable scrolling when content exceeds the maximum height
      textareaRef.current.style.overflowY =
        textareaRef.current.scrollHeight > maxHeight ? "auto" : "hidden";
    }
  };

  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
    setIsTyping(true);
    // Reset typing indicator after a short delay
    clearTimeout((window as any).typingTimeout);
    (window as any).typingTimeout = setTimeout(() => {
      setIsTyping(false);
    }, 1000);
    adjustTextareaHeight();
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isStreaming) {
      e.preventDefault();
      if (textInput.trim() !== "" || files.length > 0) {
        handleInference(textInput, files);
        setTextInput("");
      }
    }
  };

  const handleVoiceInput = (transcript: string) => {
    setTextInput((prevText) => prevText + (prevText ? " " : "") + transcript);
    setIsTyping(true);
    clearTimeout((window as any).typingTimeout);
    (window as any).typingTimeout = setTimeout(() => {
      setIsTyping(false);
    }, 1000);
    adjustTextareaHeight();
  };

  const handleTouchStart = (message: string) => {
    setTouchFeedback(message);
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  const handleTouchEnd = () => {
    setTimeout(() => setTouchFeedback(""), 500);
  };

  const handleNavigateToRagManagement = () => {
    navigate("/rag-management");
    setShowPdfDialog(false);
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

        const pdfFiles = uploadedFiles.filter(isPdfFile);
        if (pdfFiles.length > 0) {
          setPdfFileName(pdfFiles[0].name);
          setShowPdfDialog(true);
          setShowProgressBar(false);

          const nonPdfFiles = uploadedFiles.filter((file) => !isPdfFile(file));
          if (nonPdfFiles.length > 0) {
            await handleNonPdfFiles(nonPdfFiles);
          }
          return;
        }

        await handleNonPdfFiles(uploadedFiles);
      } catch (error) {
        console.error("File upload error:", error);
        customToast.error(
          error instanceof Error ? error.message : "Failed to upload file(s). Please try again."
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

  const handleNonPdfFiles = async (uploadedFiles: File[]) => {
    const unsupportedFiles = uploadedFiles.filter(
      (file) => !isImageFile(file) && !isTextFile(file)
    );

    if (unsupportedFiles.length > 0) {
      const fileNames = unsupportedFiles.map((f) => f.name).join(", ");
      customToast.error(
        `Unsupported file type(s): ${fileNames}. Only images (PNG, JPG, GIF) and text files are supported.`
      );
    }

    const validFiles = uploadedFiles.filter((file) => isImageFile(file) || isTextFile(file));

    const imageFiles = validFiles.filter(isImageFile);
    const textFiles = validFiles.filter(isTextFile);

    if (imageFiles.length > 0) {
      const existingImages = files.filter((f) => f.type === "image_url");
      if (existingImages.length > 0) {
        setPendingImageFile(imageFiles[0]);
        setShowReplaceDialog(true);

        if (textFiles.length > 0) {
          const encodedTextFiles = await Promise.all(textFiles.map(processFile));
          setFiles((prevFiles) => [...prevFiles, ...encodedTextFiles]);
          customToast.success(`Successfully uploaded ${textFiles.length} text file(s)!`);
        }
        return;
      }

      const encodedImage = await processFile(imageFiles[0]);
      const encodedTextFiles = await Promise.all(textFiles.map(processFile));

      setFiles((prevFiles) => [...prevFiles, encodedImage, ...encodedTextFiles]);
      customToast.success(
        `Successfully uploaded ${
          imageFiles.length > 1 ? "1 image (extras ignored)" : "1 image"
        }${textFiles.length > 0 ? ` and ${textFiles.length} text file(s)` : ""}!`
      );
    } else if (textFiles.length > 0) {
      const encodedFiles = await Promise.all(textFiles.map(processFile));
      setFiles((prevFiles) => [...prevFiles, ...encodedFiles]);
      customToast.success(`Successfully uploaded ${textFiles.length} text file(s)!`);
    }
  };

  const handleReplaceConfirm = async () => {
    if (pendingImageFile) {
      try {
        const encodedImage = await processFile(pendingImageFile);
        setFiles((prevFiles) => [...prevFiles.filter((f) => f.type !== "image_url"), encodedImage]);
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
      <PdfDetectionDialog
        open={showPdfDialog}
        onOpenChange={setShowPdfDialog}
        pdfFileName={pdfFileName}
        onNavigate={handleNavigateToRagManagement}
      />

      <AlertDialog open={showReplaceDialog} onOpenChange={setShowReplaceDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace Existing Image?</AlertDialogTitle>
            <AlertDialogDescription>
              You can only have one image at a time. Do you want to replace the existing image with
              the new one?
              {pendingImageFile && (
                <div className="mt-2 text-sm">New image: {pendingImageFile.name}</div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleReplaceCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReplaceConfirm}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {touchFeedback && (
        <div className="fixed top-1/4 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gray-800 text-white text-sm rounded-lg px-4 py-2 z-50 opacity-80">
          {touchFeedback}
        </div>
      )}

      <div className="flex-shrink-0 w-full mt-2">
        <div
          className={cn(
            "relative w-full bg-white dark:bg-[#2A2A2A] rounded-lg p-2 sm:p-4 shadow-lg dark:shadow-2xl border transition-all duration-200",
            isTyping && !textInput
              ? "border-[#7C68FA] dark:border-[#7C68FA] shadow-[0_0_0_1px_#7C68FA]"
              : isFocused || isTouched
                ? "border-[#7C68FA]/70 dark:border-[#7C68FA]/60"
                : isHovered
                  ? "border-gray-400/70 dark:border-white/30"
                  : "border-gray-200 dark:border-[#7C68FA]/20",
            "overflow-hidden"
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onTouchStart={() => setIsTouched(true)}
          onTouchEnd={() => {
            setTimeout(() => setIsTouched(false), 300);
          }}
        >
          {isDragging && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-lg font-semibold z-50">
              <div className="bg-white/20 rounded-lg p-8 flex flex-col items-center transition-all duration-300 ease-in-out">
                <Paperclip className="h-12 w-12 mb-4 animate-bounce" />
                <span className="text-2xl animate-pulse">Drop files to upload</span>
                <span className="text-sm mt-2">
                  Limited to one image, multiple text files allowed
                </span>
              </div>
            </div>
          )}

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
                    <span className="text-sm truncate max-w-[150px]">{file.name}</span>
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

          <div className="relative">
            <textarea
              ref={textareaRef}
              value={textInput}
              onChange={handleTextAreaInput}
              onKeyDown={handleKeyPress}
              placeholder=""
              className="w-full h-full bg-transparent border-none focus:outline-none resize-none font-mono text-base leading-normal overflow-y-auto py-1 px-1"
              disabled={isStreaming}
              rows={1}
              style={{
                minHeight: isMobileView ? "36px" : "24px",
                maxHeight: isMobileView ? "80px" : "200px",
                fontSize: isMobileView ? "16px" : "inherit",
                lineHeight: isMobileView ? "1.2" : "inherit",
                WebkitAppearance: "none",
              }}
              aria-label="Chat input"
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onTouchStart={() => setIsTouched(true)}
              onTouchEnd={() => {
                setTimeout(() => {
                  if (!isFocused) setIsTouched(false);
                }, 300);
              }}
            />
            {!textInput && !isFocused && (
              <div className="absolute inset-0 pointer-events-none">
                <TypingAnimation
                  texts={EXAMPLE_PROMPTS}
                  duration={50}
                  cycleDelay={2000}
                  className="absolute inset-0 flex items-center px-1 text-gray-400 dark:text-gray-500"
                />
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mt-2">
            <div className="flex gap-2 items-center">
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
                        <Paperclip className={`${isMobileView ? "h-4 w-4" : "h-5 w-5"}`} />
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

              <div className="relative group">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <VoiceInput
                          onTranscript={handleVoiceInput}
                          isListening={isListening}
                          setIsListening={setIsListening}
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
                          ? "justify-center h-8 w-8 p-0"
                          : "justify-center gap-1.5 px-3 py-1"
                      }
                    `}
                    aria-label="Start a new chat"
                  >
                    <Plus className={isMobileView ? "h-4 w-4" : "h-4 w-4"} />
                    {!isMobileView && <span className="text-xs">New chat</span>}
                  </Button>
                  {isMobileView && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      New chat
                    </div>
                  )}
                </div>
              )}

              {isStreaming ? (
                <div className="relative group">
                  <Button
                    onClick={() => {
                      if (onStopInference) {
                        handleTouchStart("Stopping generation");
                        onStopInference();
                        handleTouchEnd();
                      }
                    }}
                    onTouchStart={() => handleTouchStart("Stopping generation")}
                    onTouchEnd={handleTouchEnd}
                    className={`
                      bg-red-500 hover:bg-red-600 active:bg-red-700 text-white 
                      dark:bg-red-500 dark:hover:bg-red-600 dark:active:bg-red-700
                      ${isMobileView ? "px-3 py-2 text-sm" : "px-4 py-2 text-sm"} 
                      rounded-lg flex items-center gap-1 sm:gap-2 transition-all duration-200 touch-manipulation
                    `}
                    aria-label="Stop generation"
                  >
                    {isMobileView ? (
                      <X className="h-4 w-4" />
                    ) : (
                      <>
                        Stop
                        <X className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                  {isMobileView && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-1 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 pointer-events-none bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      Stop generation
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative group">
                  <Button
                    onClick={() => {
                      if ((textInput.trim() !== "" || files.length > 0) && !isStreaming) {
                        handleTouchStart("Sending message");
                        handleInference(textInput, files);
                        setTextInput("");
                        handleTouchEnd();
                      }
                    }}
                    onTouchStart={() => {
                      if ((textInput.trim() !== "" || files.length > 0) && !isStreaming) {
                        handleTouchStart("Sending message");
                      }
                    }}
                    onTouchEnd={handleTouchEnd}
                    disabled={isStreaming || (!textInput.trim() && files.length === 0)}
                    className={`
                      bg-[#7C68FA] hover:bg-[#7C68FA]/90 active:bg-[#7C68FA]/80 text-white 
                      dark:text-white
                      ${isMobileView ? "px-3 py-2 text-sm" : "px-4 py-2 text-sm"} 
                      rounded-lg flex items-center gap-1 sm:gap-2 transition-all duration-200 touch-manipulation
                      ${(!textInput.trim() && files.length === 0) || isStreaming ? "opacity-70 cursor-not-allowed" : "cursor-pointer"}
                      border-0 outline-none focus:outline-none focus:ring-0
                    `}
                    aria-label={isMobileView ? "Send message" : "Generate response"}
                  >
                    {isMobileView ? (
                      <Send className="h-4 w-4" />
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
              )}
            </div>
          </div>

          {isStreaming && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#7C68FA] to-[#7C68FA] animate-pulse-ripple-x" />
            </div>
          )}

          {showProgressBar && (
            <div className="absolute bottom-0 left-0 w-full h-1 bg-green-500 animate-progress" />
          )}
          {showErrorIndicator && (
            <div className="absolute bottom-0 left-0 w-full h-1 bg-red-500 animate-pulse" />
          )}
        </div>

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
                  : "LLM's can make mistakes. Check important infos"}
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

      {isFileUploadOpen && (
        <FileUpload onChange={handleFileUpload} onClose={() => setIsFileUploadOpen(false)} />
      )}
    </>
  );
}