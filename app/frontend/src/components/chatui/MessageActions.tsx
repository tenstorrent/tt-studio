// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import { Button } from "../ui/button";
import { Clipboard, ThumbsUp, ThumbsDown, RefreshCw } from "lucide-react";
import CustomToaster, { customToast } from "../CustomToaster";

interface MessageActionsProps {
  onCopy: () => void;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  onRender: () => void;
}

const MessageActions: React.FC<MessageActionsProps> = ({
  onCopy,
  onThumbsUp,
  onThumbsDown,
  onRender,
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
            customToast.error("thanks for the feedback :(");
          }}
        >
          <ThumbsDown className="h-4 w-4" />
          <span className="sr-only">Thumbs down</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onRender();
            customToast.info("Rendering message");
          }}
        >
          <RefreshCw className="h-4 w-4" />
          <span className="sr-only">Render message</span>
        </Button>
      </div>
    </>
  );
};

export default MessageActions;
