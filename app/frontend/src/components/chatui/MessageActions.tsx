// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import { Button } from "../ui/button";
import {
  Clipboard,
  ThumbsUp,
  ThumbsDown,
  RefreshCw,
  MoreHorizontal,
} from "lucide-react";
import CustomToaster, { customToast } from "../CustomToaster";

interface MessageActionsProps {
  messageId: string;
  onReRender: (messageId: string) => void;
  onContinue: (messageId: string) => void;
  isReRendering: boolean;
  isStreaming: boolean;
}

const MessageActions: React.FC<MessageActionsProps> = ({
  messageId,
  onReRender,
  onContinue,
  isReRendering,
  isStreaming,
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
      <div className="flex items-center gap-2 mt-2">
        <Button variant="ghost" size="icon" onClick={handleCopy}>
          <Clipboard className="h-4 w-4" />
          <span className="sr-only">Copy message</span>
        </Button>
        <Button variant="ghost" size="icon" onClick={handleThumbsUp}>
          <ThumbsUp className="h-4 w-4" />
          <span className="sr-only">Thumbs up</span>
        </Button>
        <Button variant="ghost" size="icon" onClick={handleThumbsDown}>
          <ThumbsDown className="h-4 w-4" />
          <span className="sr-only">Thumbs down</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onReRender(messageId);
            customToast.info("Re-rendering message");
          }}
          disabled={isReRendering || isStreaming}
        >
          <RefreshCw
            className={`h-4 w-4 ${isReRendering ? "animate-spin" : ""}`}
          />
          <span className="sr-only">Re-render message</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onContinue(messageId);
            customToast.info("Continuing from previous response");
          }}
          disabled={isStreaming}
        >
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Continue from previous response</span>
        </Button>
      </div>
    </>
  );
};

export default MessageActions;
