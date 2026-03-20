// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
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
import { parseAnsiColors } from "../../lib/ansi";
import LogView from "../models/Logs/LogView";

interface Props {
  open: boolean;
  deploymentId: number | null;
  modelName?: string;
  onClose: () => void;
}

const ALL_LEVELS = ["INFO", "DEBUG", "TRACE", "ERROR", "WARNING", "FATAL"] as const;

const LEVEL_COLORS: Record<string, { active: string; inactive: string }> = {
  INFO:    { active: "bg-blue-600 text-white", inactive: "bg-gray-800 text-gray-500 hover:text-gray-300" },
  DEBUG:   { active: "bg-gray-600 text-white", inactive: "bg-gray-800 text-gray-500 hover:text-gray-300" },
  TRACE:   { active: "bg-gray-600 text-white", inactive: "bg-gray-800 text-gray-500 hover:text-gray-300" },
  ERROR:   { active: "bg-red-600 text-white", inactive: "bg-gray-800 text-gray-500 hover:text-gray-300" },
  WARNING: { active: "bg-yellow-600 text-white", inactive: "bg-gray-800 text-gray-500 hover:text-gray-300" },
  FATAL:   { active: "bg-red-700 text-white", inactive: "bg-gray-800 text-gray-500 hover:text-gray-300" },
};

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
  const [activeLevels, setActiveLevels] = useState<Set<string>>(
    () => new Set(ALL_LEVELS)
  );

  const allActive = activeLevels.size === ALL_LEVELS.length;

  const toggleLevel = (level: string) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const resetLevels = () => setActiveLevels(new Set(ALL_LEVELS));

  const filterLog = useCallback(
    (line: string) => {
      if (allActive) return true;
      const parsed = parseAnsiColors(line);
      // When filtering, only show lines with a recognized level that matches
      if (!parsed.level) return false;
      return activeLevels.has(parsed.level);
    },
    [activeLevels, allActive]
  );

  const filteredCount = useMemo(() => {
    if (allActive) return logs.length;
    return logs.filter(filterLog).length;
  }, [logs, filterLog, allActive]);

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

        {/* Filter bar */}
        <div className="shrink-0 flex items-center gap-2 py-2">
          <span className="text-xs text-gray-400 mr-1">Filter:</span>
          {ALL_LEVELS.map((level) => {
            const isActive = activeLevels.has(level);
            const colors = LEVEL_COLORS[level];
            return (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors duration-100 ${
                  isActive ? colors.active : colors.inactive
                }`}
              >
                {level}
              </button>
            );
          })}
          {!allActive && (
            <button
              onClick={resetLevels}
              className="px-2.5 py-1 rounded text-xs font-medium text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 transition-colors duration-100 ml-1"
            >
              Show All
            </button>
          )}
          <span className="text-xs text-gray-500 ml-auto">
            {filteredCount === logs.length
              ? `${logs.length} lines`
              : `${filteredCount} / ${logs.length} lines`}
          </span>
        </div>

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
                filterLog={filterLog}
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
