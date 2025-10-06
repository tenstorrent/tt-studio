// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useMemo, useRef, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs";
import { Spinner } from "../../ui/spinner";
import { Button } from "../../ui/button";
import { ChevronDown } from "lucide-react";
import { useLogStream } from "../../../hooks/useLogStream";
import { parseAnsiColors, getLogLevelColor } from "../../../lib/ansi";
import { Switch } from "../../ui/switch";

interface Props {
  open: boolean;
  containerId: string;
  modelName?: string;
  onClose: () => void;
}

export default function LogStreamDialog({
  open,
  containerId,
  modelName,
  onClose,
}: Props) {
  const {
    logs,
    events,
    metrics,
    error,
    isLoading,
    filters,
    setFilters,
    filterLog,
  } = useLogStream(open, containerId);
  const [activeTab, setActiveTab] = useState("logs");

  const shortName = useMemo(
    () => (modelName ? modelName.split("/").slice(-1)[0] : undefined),
    [modelName]
  );
  const isHFModel = useMemo(
    () => !!modelName && /.+\/.+/.test(modelName),
    [modelName]
  );

  const logsRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const getCurrentRef = () => {
    if (activeTab === "logs") return logsRef;
    if (activeTab === "events") return eventsRef;
    if (activeTab === "metrics") return metricsRef;
    return logsRef;
  };

  useEffect(() => {
    const currentRef = getCurrentRef();
    if (autoScrollEnabled && currentRef.current) {
      currentRef.current.scrollTop = currentRef.current.scrollHeight;
    }
  }, [logs, events, metrics, autoScrollEnabled, activeTab]);

  const handleScroll = () => {
    const ref = getCurrentRef();
    if (ref.current) {
      const isAtBottom =
        ref.current.scrollHeight -
          ref.current.scrollTop -
          ref.current.clientHeight <
        10;
      setAutoScrollEnabled(isAtBottom);
      setShowScrollButton(!isAtBottom);
    }
  };

  const scrollToBottom = () => {
    const ref = getCurrentRef();
    if (ref.current) {
      ref.current.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "smooth",
      });
      setAutoScrollEnabled(true);
      setShowScrollButton(false);
    }
  };

  const HuggingFaceBadge = () => (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-400 text-black text-[11px] leading-none mr-1">
      🤗
    </span>
  );

  const renderLoading = () => {
    const colorClass =
      activeTab === "logs"
        ? "text-green-400"
        : activeTab === "events"
          ? "text-blue-400"
          : "text-yellow-400";
    const message =
      activeTab === "logs"
        ? "Connecting to log stream..."
        : activeTab === "events"
          ? "Connecting to event stream..."
          : "Connecting to metrics stream...";
    return (
      <div
        className={`bg-gray-950 ${colorClass} p-4 rounded-lg font-mono text-sm border border-gray-700 shadow-inner flex items-center justify-center h-32`}
      >
        <div className="flex flex-col items-center gap-2">
          <Spinner className="w-8 h-8" />
          <span className="text-sm">{message}</span>
        </div>
      </div>
    );
  };

  const renderError = () => (
    <div className="flex flex-col gap-4">
      <div className="text-red-500">{error}</div>
      <Button
        onClick={onClose}
        className="bg-blue-500 hover:bg-blue-600 text-white w-32"
      >
        Close
      </Button>
    </div>
  );

  const renderLogs = () => (
    <div
      ref={logsRef}
      onScroll={handleScroll}
      className="bg-gray-950 text-green-400 p-4 rounded-lg font-mono text-sm overflow-auto h-full relative border border-gray-700 shadow-inner"
      style={{
        lineHeight: "1.5",
        scrollBehavior: "smooth",
        fontFamily: 'Consolas, "Courier New", "Monaco", monospace',
      }}
    >
      {logs.length === 0 ? (
        <div className="text-gray-500 italic">
          No logs available - waiting for container output...
        </div>
      ) : (
        logs.filter(filterLog).map((log, index) => {
          const parsed = parseAnsiColors(log);
          return (
            <div
              key={index}
              className={`whitespace-pre-wrap leading-relaxed py-0.5 hover:bg-gray-900 hover:bg-opacity-30 transition-colors duration-150 group ${
                log.includes("ERROR") || log.includes(" 500 ")
                  ? "text-red-400"
                  : ""
              }`}
              style={{
                wordWrap: "break-word",
                overflowWrap: "break-word",
                fontFamily: 'Consolas, "Courier New", "Monaco", monospace',
              }}
            >
              <span className="text-gray-500 text-xs mr-2 select-none">
                {String(index + 1).padStart(3, "0")}
              </span>
              {parsed.level && (
                <span
                  className={`text-xs font-bold mr-2 ${getLogLevelColor(parsed.level)}`}
                >
                  [{parsed.level}]
                </span>
              )}
              <span className="terminal-content">
                {parsed.segments.map((segment, segIndex) => (
                  <span
                    key={segIndex}
                    style={{
                      color:
                        segment.color || (parsed.level ? undefined : "#50FA7B"),
                      backgroundColor: segment.backgroundColor,
                      fontWeight: segment.bold ? "bold" : "normal",
                      fontStyle: segment.italic ? "italic" : "normal",
                    }}
                  >
                    {segment.text}
                  </span>
                ))}
              </span>
            </div>
          );
        })
      )}
      {logs.length > 0 && (
        <div className="flex items-center mt-2 opacity-75">
          <span className="text-gray-500 text-xs mr-2 select-none">$</span>
          <span className="text-green-400 animate-pulse text-sm">█</span>
        </div>
      )}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-full shadow-lg transition-all duration-200 z-10"
          title="Scroll to bottom"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
      )}
    </div>
  );

  const renderEvents = () => (
    <div
      ref={eventsRef}
      onScroll={handleScroll}
      className="bg-gray-950 text-blue-400 p-4 rounded-lg font-mono text-sm overflow-auto h-full relative border border-gray-700 shadow-inner"
      style={{
        lineHeight: "1.5",
        scrollBehavior: "smooth",
        fontFamily:
          'Consolas, "Monaco", "Lucida Console", "Liberation Mono", "DejaVu Sans Mono", "Bitstream Vera Sans Mono", "Courier New", monospace',
      }}
    >
      {events.length === 0 ? (
        <div className="text-gray-500 italic">
          No events available - container events will appear here...
        </div>
      ) : (
        events.map((event, index) => {
          const parsed = parseAnsiColors(event);
          const isError =
            parsed.level &&
            ["ERROR", "FATAL", "CRITICAL"].includes(parsed.level);
          const isWarning =
            parsed.level && ["WARN", "WARNING"].includes(parsed.level);
          const isInfo = parsed.level && ["INFO"].includes(parsed.level);
          const isStartupEvent =
            event.includes("startup complete") ||
            event.includes("Uvicorn running") ||
            event.includes("Started server process");
          return (
            <div
              key={index}
              className={`whitespace-pre-wrap leading-relaxed py-1 px-2 rounded hover:bg-gray-900 hover:bg-opacity-50 transition-colors duration-150 group mb-1 border-l-4 ${
                isError
                  ? "border-red-500 bg-red-900 bg-opacity-20"
                  : isWarning
                    ? "border-yellow-500 bg-yellow-900 bg-opacity-20"
                    : isInfo || isStartupEvent
                      ? "border-green-500 bg-green-900 bg-opacity-20"
                      : "border-blue-500 bg-blue-900 bg-opacity-20"
              }`}
              style={{
                wordWrap: "break-word",
                overflowWrap: "break-word",
                fontFamily: 'Consolas, "Courier New", "Monaco", monospace',
              }}
            >
              <div className="flex items-start gap-2">
                <span className="text-gray-500 text-xs mr-1 select-none shrink-0">
                  {String(index + 1).padStart(3, "0")}
                </span>
                <div className="flex-1">
                  {parsed.level && (
                    <span
                      className={`text-xs font-bold mr-2 px-1 py-0.5 rounded ${
                        isError
                          ? "bg-red-500 text-white"
                          : isWarning
                            ? "bg-yellow-500 text-black"
                            : isInfo || isStartupEvent
                              ? "bg-green-500 text-white"
                              : "bg-blue-500 text-white"
                      }`}
                    >
                      {parsed.level}
                    </span>
                  )}
                  <span className="terminal-content">
                    {parsed.segments.map((segment, segIndex) => (
                      <span
                        key={segIndex}
                        style={{
                          color:
                            segment.color ||
                            (isError
                              ? "#FF6B6B"
                              : isWarning
                                ? "#FFD93D"
                                : isInfo || isStartupEvent
                                  ? "#50FA7B"
                                  : "#8BE9FD"),
                          backgroundColor: segment.backgroundColor,
                          fontWeight: segment.bold ? "bold" : "normal",
                          fontStyle: segment.italic ? "italic" : "normal",
                        }}
                      >
                        {segment.text}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  const renderMetrics = () => (
    <div
      ref={metricsRef}
      onScroll={handleScroll}
      className="bg-gray-950 text-yellow-400 p-4 rounded-lg font-mono text-sm overflow-auto h-full relative border border-gray-700 shadow-inner"
      style={{
        lineHeight: "1.5",
        scrollBehavior: "smooth",
        fontFamily:
          'Consolas, "Monaco", "Lucida Console", "Liberation Mono", "DejaVu Sans Mono", "Bitstream Vera Sans Mono", "Courier New", monospace',
      }}
    >
      {Object.keys(metrics).length === 0 ? (
        <div className="text-gray-500 italic">
          No metrics available - container metrics will appear here...
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(metrics).map(([name, value]) => (
            <div
              key={name}
              className="flex justify-between items-center p-2 bg-gray-900 bg-opacity-30 rounded hover:bg-opacity-50 transition-colors duration-150"
              style={{ fontFamily: 'Consolas, "Courier New", monospace' }}
            >
              <span className="text-yellow-300 font-medium">
                {name.replace(/_/g, " ").toUpperCase()}:
              </span>
              <span className="font-bold text-yellow-400">
                {typeof value === "number"
                  ? value.toLocaleString()
                  : (value as any)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-6xl max-h-[95vh] min-w-[600px] min-h-[400px] resize flex flex-col"
        style={{ resize: "both" }}
      >
        <DialogHeader className="shrink-0 pb-4 border-b border-gray-200 dark:border-gray-700">
          <DialogTitle className="flex items-center gap-2">
            <span className="flex items-center gap-2">
              {isHFModel && <HuggingFaceBadge />}
              <span>Container Monitoring - {shortName || containerId}</span>
            </span>
            {!isLoading && !error && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-green-600 font-medium">LIVE</span>
              </div>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 mb-4 p-4 bg-gradient-to-r from-stone-50 to-stone-100 dark:from-stone-900 dark:to-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-stone-900/10 dark:bg-stone-100/10">
                <svg
                  className="w-4 h-4 text-stone-700 dark:text-stone-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
              </div>
              <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                Filters
              </span>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-stone-600 dark:text-stone-400">
                    Health Checks
                  </span>
                  <Switch
                    checked={filters.showHealthChecks}
                    onCheckedChange={(checked) =>
                      setFilters((p) => ({ ...p, showHealthChecks: checked }))
                    }
                    className="data-[state=checked]:bg-green-600 dark:data-[state=checked]:bg-green-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-stone-600 dark:text-stone-400">
                    Metrics
                  </span>
                  <Switch
                    checked={filters.showMetrics}
                    onCheckedChange={(checked) =>
                      setFilters((p) => ({ ...p, showMetrics: checked }))
                    }
                    className="data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-blue-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-stone-600 dark:text-stone-400">
                    Errors
                  </span>
                  <Switch
                    checked={filters.showErrors}
                    onCheckedChange={(checked) =>
                      setFilters((p) => ({ ...p, showErrors: checked }))
                    }
                    className="data-[state=checked]:bg-red-600 dark:data-[state=checked]:bg-red-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 min-h-0 flex flex-col"
        >
          <TabsList className="grid w-full grid-cols-3 shrink-0 mb-4">
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>
          <div className="flex-1 min-h-0 overflow-auto">
            {isLoading
              ? renderLoading()
              : error
                ? renderError()
                : activeTab === "logs"
                  ? renderLogs()
                  : activeTab === "events"
                    ? renderEvents()
                    : renderMetrics()}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
