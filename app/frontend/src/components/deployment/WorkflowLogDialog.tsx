// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useRef, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { Button } from "../ui/button";
import { ChevronDown } from "lucide-react";
import { useWorkflowLogStream } from "../../hooks/useWorkflowLogStream";
import LogView from "../models/Logs/LogView";

interface Props {
  open: boolean;
  deploymentId: number | null;
  modelName?: string;
  onClose: () => void;
}

export default function WorkflowLogDialog({
  open,
  deploymentId,
  modelName,
  onClose,
}: Props) {
  const { logs, error, isLoading } = useWorkflowLogStream(open, deploymentId);
  const logsRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  useEffect(() => {
    if (autoScrollEnabled && logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs, autoScrollEnabled]);

  const handleScroll = () => {
    if (logsRef.current) {
      const isAtBottom =
        logsRef.current.scrollHeight -
          logsRef.current.scrollTop -
          logsRef.current.clientHeight <
        10;
      setAutoScrollEnabled(isAtBottom);
      setShowScrollButton(!isAtBottom);
    }
  };

  const scrollToBottom = () => {
    if (logsRef.current) {
      logsRef.current.scrollTo({
        top: logsRef.current.scrollHeight,
        behavior: "smooth",
      });
      setAutoScrollEnabled(true);
      setShowScrollButton(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Workflow Logs
            {modelName && (
              <span className="text-sm font-normal text-muted-foreground">
                - {modelName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {isLoading && (
            <div className="flex items-center justify-center h-64">
              <Spinner />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading logs...
              </span>
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 text-destructive p-4 rounded-md mb-4">
              <p className="text-sm font-medium">Error loading logs</p>
              <p className="text-xs mt-1">{error}</p>
            </div>
          )}

          {!isLoading && !error && (
            <div className="flex-1 min-h-0 relative overflow-hidden">
              <LogView
                logs={logs}
                filterLog={() => true}
                onScroll={handleScroll}
                scrollRef={logsRef}
                showScrollButton={showScrollButton}
                scrollToBottom={scrollToBottom}
              />
              {showScrollButton && (
                <Button
                  onClick={scrollToBottom}
                  className="absolute bottom-4 right-4 rounded-full p-2 h-10 w-10 shadow-lg"
                  variant="secondary"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

