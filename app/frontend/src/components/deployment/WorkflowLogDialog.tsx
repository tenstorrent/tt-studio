// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { Button } from "../ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { AlertTriangle, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useWorkflowLogStream } from "../../hooks/useWorkflowLogStream";
import { parseAnsiColors } from "../../lib/ansi";
import LogView from "../models/Logs/LogView";

interface Props {
  open: boolean;
  deploymentId: number | null;
  modelName?: string;
  diedUnexpectedly?: boolean;
  onClose: () => void;
  onRequestBoardReset?: () => void;
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

const CRITICAL_LEVELS = new Set(["ERROR", "FATAL", "CRITICAL"]);

export default function WorkflowLogDialog({
  open,
  deploymentId,
  modelName,
  diedUnexpectedly,
  onClose,
  onRequestBoardReset,
}: Props) {
  const { logs, error, isLoading, isComplete } = useWorkflowLogStream(open, deploymentId);
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
      if (!parsed.level) return false;
      return activeLevels.has(parsed.level);
    },
    [activeLevels, allActive]
  );

  const filteredCount = useMemo(() => {
    if (allActive) return logs.length;
    return logs.filter(filterLog).length;
  }, [logs, filterLog, allActive]);

  // Derived: list of critical error lines with their original index
  const criticalErrors = useMemo(
    () =>
      logs
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => {
          const { level } = parseAnsiColors(line);
          return level && CRITICAL_LEVELS.has(level);
        }),
    [logs]
  );

  // Derived: whether a TT hardware ethernet error is present
  const showHardwareBanner = useMemo(
    () =>
      logs.some(
        (line) =>
          line.includes("TT_THROW") &&
          (line.includes("ethernet core") || line.includes("resetting the board"))
      ),
    [logs]
  );

  // Reset scroll state when dialog closes
  useEffect(() => {
    if (!open) {
      setAutoScrollEnabled(true);
      setShowScrollButton(false);
    }
  }, [open]);

  // During streaming: auto-scroll to bottom
  useEffect(() => {
    if (autoScrollEnabled && !isComplete && logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs, autoScrollEnabled, isComplete]);

  // Once streaming completes: jump to first error (died unexpectedly) or scroll to bottom
  useEffect(() => {
    if (!isComplete) return;
    if (diedUnexpectedly && criticalErrors.length > 0) {
      requestAnimationFrame(() => {
        const target = logsRef.current?.querySelector(
          `[data-log-index="${criticalErrors[0].index}"]`
        );
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          setAutoScrollEnabled(false);
          setShowScrollButton(true);
        }
      });
    } else if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [isComplete]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Jump to a specific log line, resetting filters first so the line is visible
  const scrollToLogLine = useCallback((originalIndex: number) => {
    setActiveLevels(new Set(ALL_LEVELS));
    requestAnimationFrame(() => {
      const target = logsRef.current?.querySelector(
        `[data-log-index="${originalIndex}"]`
      );
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setAutoScrollEnabled(false);
        setShowScrollButton(true);
      }
    });
  }, []);

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

        {/* Hardware reset banner */}
        {showHardwareBanner && (
          <div className="shrink-0 flex items-start gap-3 bg-amber-950/60 border border-amber-600/70 text-amber-200 rounded-lg px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-300">
                TT Hardware Error Detected
              </p>
              <p className="text-xs mt-0.5 text-amber-200/80">
                An Ethernet core timed out (
                <code className="font-mono text-amber-300">TT_THROW</code>
                ). The board needs a hardware reset before deploying again.
              </p>
            </div>
            <button
              onClick={() => {
                onClose();
                onRequestBoardReset?.();
              }}
              className="shrink-0 flex items-center gap-1.5 text-xs font-medium bg-amber-700/60 hover:bg-amber-600/70 text-amber-100 px-2.5 py-1.5 rounded transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Board
            </button>
          </div>
        )}

        {/* Critical errors summary panel */}
        {criticalErrors.length > 0 && (
          <Collapsible
            defaultOpen={diedUnexpectedly}
            className="shrink-0 border border-red-800/60 rounded-lg bg-red-950/20 overflow-hidden"
          >
            <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-950/30 transition-colors group">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                Critical Errors
                <span className="text-xs font-normal text-red-400/80">
                  ({criticalErrors.length}{" "}
                  {criticalErrors.length === 1 ? "line" : "lines"})
                </span>
              </div>
              <ChevronRight className="h-4 w-4 text-red-400 transition-transform group-data-[state=open]:rotate-90" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="max-h-40 overflow-y-auto px-4 py-2 space-y-0.5 border-t border-red-800/40">
                {criticalErrors.map(({ line, index }) => (
                  <button
                    key={index}
                    onClick={() => scrollToLogLine(index)}
                    className="w-full text-left flex items-baseline gap-2 py-0.5 px-1 rounded hover:bg-red-900/30 transition-colors group/item"
                  >
                    <span className="text-red-500/70 text-xs font-mono w-8 text-right group-hover/item:text-red-400 shrink-0">
                      {index + 1}
                    </span>
                    <span className="text-red-300 text-xs font-mono truncate">
                      {parseAnsiColors(line).text.slice(0, 120)}
                    </span>
                  </button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

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
