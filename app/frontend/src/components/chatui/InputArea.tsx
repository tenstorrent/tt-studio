// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Paperclip, Send, X, File } from "lucide-react";
import { VoiceInput } from "./VoiceInput";
import { FileUpload } from "../ui/file-upload";
import { isImageFile, validateFile, encodeFile } from "./fileUtils";
import { cn } from "../../lib/utils";
import type { FileData, InputAreaProps } from "./types";
import { customToast } from "../CustomToaster";

export default function InputArea({
  textInput,
  setTextInput,
  handleInference,
  isStreaming,
  isListening,
  setIsListening,
  files,
  setFiles,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFileUploadOpen, setIsFileUploadOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (textareaRef.current && !isStreaming) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  useEffect(() => {
    if (textareaRef.current) {
      adjustTextareaHeight();
    }
  }, [textInput]);

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isStreaming) {
      e.preventDefault();
      handleInference(textInput, files);
    }
  };

  const handleVoiceInput = (transcript: string) => {
    setTextInput((prevText) => prevText + (prevText ? " " : "") + transcript);
  };

  const handleFileUpload = async (uploadedFiles: File[]) => {
    try {
      const encodedFiles = await Promise.all(
        uploadedFiles.map(async (file) => {
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
          console.log("Encoded file:", base64);
          return {
            type: "text" as const,
            text: base64,
            name: file.name,
          };
        })
      );
      setFiles(
        (prevFiles: FileData[]) => [...prevFiles, ...encodedFiles] as FileData[]
      );
    } catch (error) {
      console.error("File upload error:", error);
      // Consider adding toast/alert here
    }
    setIsFileUploadOpen(false);
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

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (files) handleFileUpload(Array.from(files));
  };

  return (
    <div
      className={cn(
        "relative flex-shrink-0 w-full",
        isDragging && "bg-gray-200 dark:bg-gray-700"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-lg font-semibold z-50">
          Drop files to upload
        </div>
      )}

      <div className="relative w-full bg-white dark:bg-[#2A2A2A] rounded-lg p-4 shadow-lg dark:shadow-2xl border border-gray-200 dark:border-[#7C68FA]/20 overflow-hidden">
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
          placeholder="Enter your prompt"
          className="w-full bg-transparent text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-white/70 border-none focus:outline-none resize-none font-rmMono text-base overflow-y-auto"
          disabled={isStreaming}
          rows={1}
          style={{ minHeight: "24px", maxHeight: "200px" }}
          aria-label="Chat input"
        />

        {/* Control buttons */}
        <div className="flex justify-between items-center mt-2">
          <div className="flex gap-2 items-center">
            <Button
              type="button"
              variant="ghost"
              className="text-gray-600 dark:text-white/70 hover:text-gray-800 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#7C68FA]/20 p-2 rounded-full flex items-center justify-center transition-colors duration-300"
              onClick={() => setIsFileUploadOpen(true)}
              aria-label="Attach files"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            <VoiceInput
              onTranscript={handleVoiceInput}
              isListening={isListening}
              setIsListening={setIsListening}
            />
          </div>
          <Button
            onClick={() => handleInference(textInput, files)}
            disabled={isStreaming || (!textInput.trim() && files.length === 0)}
            className="bg-[#7C68FA] hover:bg-[#7C68FA]/80 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors duration-300"
            aria-label="Send message"
          >
            Generate
            <Send className="h-4 w-4" />
          </Button>
        </div>

        {/* Preserved streaming indicator */}
        {isStreaming && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#7C68FA] to-[#7C68FA] animate-pulse-ripple-x" />
          </div>
        )}
      </div>

      {/* File upload modal */}
      {isFileUploadOpen && (
        <FileUpload
          onChange={handleFileUpload}
          onClose={() => setIsFileUploadOpen(false)}
        />
      )}
    </div>
  );
}
