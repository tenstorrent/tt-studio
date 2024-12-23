// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import { Button } from "../ui/button";
import { Clipboard, ThumbsUp, ThumbsDown } from "lucide-react";
import CustomToaster, { customToast } from "../CustomToaster";
import InferenceStats from "./InferenceStats";
import { InferenceStats as InferenceStatsType } from "./types";

interface MessageActionsProps {
  messageId: string;
  onReRender: (messageId: string) => void;
  onContinue: (messageId: string) => void;
  isReRendering: boolean;
  isStreaming: boolean;
  inferenceStats?: InferenceStatsType;
}

const MessageActions: React.FC<MessageActionsProps> = ({
  messageId,
  onReRender,
  onContinue,
  isReRendering,
  isStreaming,
  inferenceStats,
}) => {
  const handleCopy = () => {
    // Implement copy logic here
    customToast.success("Message copied to clipboard");
  };

  const handleThumbsUp = () => {
    // Implement thumbs up logic here
    customToast.success("Thanks for the feedback!");
  };

  const handleThumbsDown = () => {
    // Implement thumbs down logic here
    customToast.error("Thanks for the feedback :(");
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
          >
            <Clipboard className="h-4 w-4" />
            <span className="sr-only">Copy message</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleThumbsUp}
            className="h-8 w-8 p-0"
          >
            <ThumbsUp className="h-4 w-4" />
            <span className="sr-only">Thumbs up</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleThumbsDown}
            className="h-8 w-8 p-0"
          >
            <ThumbsDown className="h-4 w-4" />
            <span className="sr-only">Thumbs down</span>
          </Button>
          {inferenceStats && <InferenceStats stats={inferenceStats} />}
        </div>
      </div>
    </>
  );
};

export default MessageActions;
