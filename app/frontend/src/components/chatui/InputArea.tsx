// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useEffect, useRef } from "react";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { Send } from "lucide-react";
import { Spinner } from "../ui/spinner";

interface InputAreaProps {
  textInput: string;
  setTextInput: (text: string) => void;
  handleInference: (input: string) => void;
  isStreaming: boolean;
}

export default function InputArea({
  textInput,
  setTextInput,
  handleInference,
  isStreaming,
}: InputAreaProps) {
  const handleTextAreaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
    setTextInput(e.target.value);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleInference(textInput);
    }
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  return (
    <div className="flex-shrink-0 p-4">
      <div className="relative w-full">
        <Textarea
          ref={textareaRef}
          autoFocus
          value={textInput}
          onInput={handleTextAreaInput}
          onKeyDown={handleKeyPress}
          placeholder="Enter text for inference"
          className="px-4 py-2 pr-16 border rounded-lg shadow-md w-full box-border font-rmMono"
          disabled={isStreaming}
          rows={1}
          style={{
            resize: "none",
            maxHeight: "150px",
            overflowY: "auto",
          }}
        />
        <Button
          className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300"
          onClick={() => handleInference(textInput)}
          disabled={isStreaming || !textInput.trim()}
        >
          {isStreaming ? <Spinner /> : <Send className="h-5 w-5" />}
        </Button>
      </div>
    </div>
  );
}
