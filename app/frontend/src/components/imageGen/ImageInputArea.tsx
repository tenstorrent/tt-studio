// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { ImageIcon } from 'lucide-react';

interface ImageInputAreaProps {
  textInput: string;
  setTextInput: React.Dispatch<React.SetStateAction<string>>;
  handleGenerate: (input: string) => void;
  isGenerating: boolean;
}

export default function ImageInputArea({
  textInput,
  setTextInput,
  handleGenerate,
  isGenerating,
}: ImageInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isGenerating]);

  useEffect(() => {
    if (textareaRef.current) {
      adjustTextareaHeight();
    }
  }, [textInput]);

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTextInput(e.target.value);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate(textInput);
    }
  };

  return (
    <div className="flex-shrink-0 w-full">
      <div className="relative w-full rounded-lg p-4 shadow-lg border  overflow-hidden">
        <textarea
          ref={textareaRef}
          value={textInput}
          onChange={handleTextAreaInput}
          onKeyDown={handleKeyPress}
          placeholder="Describe the image you want to generate..."
          className="w-full bg-transparent text-white placeholder-gray-400 border-none focus:outline-none resize-none text-base overflow-y-auto"
          disabled={isGenerating}
          rows={1}
          style={{
            minHeight: '24px',
            maxHeight: '200px',
          }}
        />
        <div className="flex justify-end items-center mt-2">
          <Button
            onClick={() => handleGenerate(textInput)}
            disabled={isGenerating || !textInput.trim()}
            className="bg-[#7C68FA] hover:bg-[#7C68FA]/80 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors duration-300"
          >
            {isGenerating ? (
              <>Generating...</>
            ) : (
              <>
                Generate
                <ImageIcon className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
        {isGenerating && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-[#7C68FA] to-[#7C68FA] animate-pulse" />
          </div>
        )}
      </div>
    </div>
  );
}
