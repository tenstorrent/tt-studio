// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type React from "react";
import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { ImageIcon, Send, Video, X } from "lucide-react";

interface VideoI2VInputAreaProps {
  textInput: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  imageFile: File | null;
  imagePreviewUrl: string | null;
  onImageSelect: (file: File) => void;
  onImageClear: () => void;
  handleGenerate: (input: string, image: File) => void;
  isGenerating: boolean;
}

export default function VideoI2VInputArea({
  textInput,
  setTextInput,
  imageFile,
  imagePreviewUrl,
  onImageSelect,
  onImageClear,
  handleGenerate,
  isGenerating,
}: VideoI2VInputAreaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  };

  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
    adjustTextareaHeight();
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && imageFile) {
      e.preventDefault();
      handleGenerate(textInput, imageFile);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageSelect(file);
    }
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      onImageSelect(file);
    }
  };

  return (
    <div className="shrink-0 w-full">
      <div
        className={`relative w-full bg-white dark:bg-[#2A2A2A] rounded-lg p-4 shadow-lg dark:shadow-2xl overflow-hidden transition-all duration-300 ${
          isFocused
            ? "border-2 border-gray-800 dark:border-white"
            : "border border-gray-200 dark:border-[#7C68FA]/20"
        }`}
      >
        {imageFile && imagePreviewUrl ? (
          <div className="mb-3 relative inline-block">
            <img
              src={imagePreviewUrl}
              alt="Selected preview"
              className="h-24 w-auto rounded-lg object-cover border border-gray-200 dark:border-[#7C68FA]/30"
            />
            <button
              type="button"
              onClick={onImageClear}
              className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-gray-700 dark:bg-gray-900 text-white flex items-center justify-center hover:bg-gray-900 dark:hover:bg-black transition-colors"
              aria-label="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate max-w-[12rem]">
              {imageFile.name}
            </p>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                fileInputRef.current?.click();
              }
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`mb-3 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors duration-200 ${
              isDragOver
                ? "border-[#7C68FA] bg-[#7C68FA]/10"
                : "border-gray-300 dark:border-[#7C68FA]/30 hover:border-[#7C68FA] hover:bg-[#7C68FA]/5"
            }`}
          >
            <ImageIcon className="h-6 w-6 text-gray-400 dark:text-gray-500" />
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              Click to upload or drag and drop an image
            </p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFileChange}
        />

        <textarea
          ref={textareaRef}
          value={textInput}
          onChange={handleTextAreaInput}
          onKeyDown={handleKeyPress}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Add a description (optional)..."
          className="w-full h-full bg-transparent border-none focus:outline-none resize-none font-mono text-base overflow-y-auto text-gray-900 dark:text-white font-medium"
          disabled={isGenerating}
          style={{
            minHeight: "24px",
            maxHeight: "200px",
          }}
        />

        <div className="flex justify-end items-center mt-2">
          <Button
            onClick={() => {
              if (imageFile) handleGenerate(textInput, imageFile);
            }}
            disabled={isGenerating || !imageFile}
            className={`${
              isGenerating || !imageFile
                ? "bg-gray-400 dark:bg-gray-600 text-gray-600 dark:text-gray-300 cursor-not-allowed"
                : "bg-[#7C68FA] hover:bg-[#7C68FA]/80 dark:bg-emerald-600 dark:hover:bg-emerald-700 text-white font-semibold cursor-pointer"
            } px-4 py-2 rounded-lg flex items-center gap-2 transition-colors duration-300`}
          >
            {isGenerating ? "Generating..." : "Generate"}
            {isGenerating ? (
              <Video className="h-4 w-4 animate-pulse" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {isGenerating && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#7C68FA] to-[#7C68FA] animate-pulse-ripple-x" />
          </div>
        )}
      </div>
    </div>
  );
}
