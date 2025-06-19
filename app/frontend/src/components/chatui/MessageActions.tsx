// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import type React from "react";
import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Clipboard, ThumbsUp, ThumbsDown } from "lucide-react";
import CustomToaster, { customToast } from "../CustomToaster";
import InferenceStats from "./InferenceStats";
import type { InferenceStats as InferenceStatsType } from "./types";
import type { InferenceStats as InferenceStatsType } from "./types";

interface MessageActionsProps {
  messageId: string;
  onReRender: (messageId: string) => void;
  onContinue: (messageId: string) => void;
  isReRendering: boolean;
  isStreaming: boolean;
  inferenceStats?: InferenceStatsType;
  messageContent?: string;
  messageContent?: string;
}

const MessageActions: React.FC<MessageActionsProps> = ({
  // _messageId,
  // onReRender,
  // onContinue,
  // isReRendering,
  isStreaming,
  inferenceStats,
  messageContent,
  messageContent,
}) => {
  const [completeMessage, setCompleteMessage] = useState<string>(messageContent || "");

  // Add state for tracking feedback status
  const [feedback, setFeedback] = useState<"thumbsUp" | "thumbsDown" | null>(null);

  // Update the complete message when streaming finishes
  useEffect(() => {
    if (!isStreaming && messageContent) {
      setCompleteMessage(messageContent);
    }
  }, [isStreaming, messageContent]);

  const handleCopy = async () => {
    try {
      if (completeMessage) {
        await navigator.clipboard.writeText(completeMessage);
        customToast.success("Message copied to clipboard");
      }
    } catch (err) {
      console.error("Failed to copy text: ", err);
      customToast.error("Failed to copy message");
    }
  };

  const handleThumbsUp = () => {
    // Toggle thumbs up state
    const newFeedback = feedback === "thumbsUp" ? null : "thumbsUp";
    setFeedback(newFeedback);

    // Add toast notification back
    if (newFeedback === "thumbsUp") {
      customToast.success("Thanks for the feedback!");
    }

    // Here you could implement API call to save feedback
    // saveFeedback(messageId, newFeedback);
  };

  const handleThumbsDown = () => {
    // Toggle thumbs down state
    const newFeedback = feedback === "thumbsDown" ? null : "thumbsDown";
    setFeedback(newFeedback);

    // Add toast notification back
    if (newFeedback === "thumbsDown") {
      customToast.error("Thanks for the feedback :(");
    }

    // Here you could implement API call to save feedback
    // saveFeedback(messageId, newFeedback);
  };

  return (
    <>
      <CustomToaster />
      <div className="flex items-center justify-between w-full mt-2 gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            className="h-8 w-8 p-0"
            disabled={isStreaming}
          >
            <Clipboard className="h-4 w-4" />
            <span className="sr-only">Copy message</span>
          </Button>

          {/* Enhanced ThumbsUp button with active state */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleThumbsUp}
            className={`h-8 w-8 p-0 transition-colors ${
              feedback === "thumbsUp"
                ? "bg-TT-purple-tint2 text-TT-purple-accent dark:bg-TT-purple-shade dark:text-TT-purple hover:bg-TT-purple-tint1 dark:hover:bg-TT-purple"
                : "hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
            style={{ outline: "none" }}
          >
            <ThumbsUp
              className="h-4 w-4"
              fill={feedback === "thumbsUp" ? "currentColor" : "none"}
            />
            <span className="sr-only">Thumbs up</span>
          </Button>

          {/* Enhanced ThumbsDown button with active state */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleThumbsDown}
            className={`h-8 w-8 p-0 transition-colors ${
              feedback === "thumbsDown"
                ? "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800"
                : "hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
            style={{ outline: "none" }}
          >
            <ThumbsDown
              className="h-4 w-4"
              fill={feedback === "thumbsDown" ? "currentColor" : "none"}
            />
            <span className="sr-only">Thumbs down</span>
          </Button>

          {inferenceStats && <InferenceStats stats={inferenceStats} />}
        </div>
      </div>
    </>
  );
};

export default MessageActions;
