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
  onCopy: () => void;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  onRender: (messageId: string) => void;
  onContinue: (messageId: string) => void;
  isReRendering: boolean;
  isStreaming: boolean;
}

const MessageActions: React.FC<MessageActionsProps> = ({
  messageId,
  onCopy,
  onThumbsUp,
  onThumbsDown,
  onRender,
  onContinue,
  isReRendering,
  isStreaming,
}) => {
  return (
    <>
      <CustomToaster />
      <div className="flex items-center gap-2 mt-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onCopy();
            customToast.success("Message copied to clipboard");
          }}
        >
          <Clipboard className="h-4 w-4" />
          <span className="sr-only">Copy message</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onThumbsUp();
            customToast.success("Thanks for the feedback!");
          }}
        >
          <ThumbsUp className="h-4 w-4" />
          <span className="sr-only">Thumbs up</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onThumbsDown();
            customToast.error("Thanks for the feedback :(");
          }}
        >
          <ThumbsDown className="h-4 w-4" />
          <span className="sr-only">Thumbs down</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onRender(messageId);
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
