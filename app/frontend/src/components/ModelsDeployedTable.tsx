// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
// import { Separator } from "./ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import {
  Table,
  TableBody,
  // TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";
import { useTheme } from "../hooks/useTheme";
import CustomToaster, { customToast } from "./CustomToaster";
import { Spinner } from "./ui/spinner";
import CopyableText from "./CopyableText";
import StatusBadge from "./StatusBadge";
import HealthBadge, { type HealthBadgeRef } from "./HealthBadge";
import {
  fetchModels,
  getModelTypeFromName,
  deleteModel,
  handleRedeploy,
  ModelType,
  handleModelNavigationClick,
  extractShortModelName,
} from "../api/modelsDeployedApis";
import { NoModelsDialog } from "./NoModelsDeployed";
import { ModelsDeployedSkeleton } from "./ModelsDeployedSkeleton";
import { useRefresh } from "../hooks/useRefresh";
import { useModels } from "../hooks/useModels";
import {
  // Box,
  Image,
  Activity,
  Heart,
  Network,
  Tag,
  Settings,
  Trash2,
  MessageSquare,
  AlertCircle,
  Eye,
  AudioLines,
  X,
  FileText,
  // ChevronLeft,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  RefreshCw,
  Code,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Switch } from "./ui/switch";

// ANSI color code parsing utilities
const ANSI_REGEX = /\\u001b\[[0-9;]*m/g;
const LOG_LEVEL_REGEX = /(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL)/i;

interface ParsedLogLine {
  text: string;
  level?: string;
  hasColors: boolean;
  segments: Array<{
    text: string;
    color?: string;
    backgroundColor?: string;
    bold?: boolean;
    italic?: boolean;
  }>;
}

// Map ANSI color codes to CSS classes
const ansiToColor = (
  code: string
): {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
} => {
  const num = parseInt(code);
  const styles: any = {};

  switch (num) {
    case 0:
      return {}; // Reset
    case 1:
      styles.bold = true;
      break; // Bold
    case 3:
      styles.italic = true;
      break; // Italic
    case 30:
      styles.color = "#000000";
      break; // Black
    case 31:
      styles.color = "#FF5555";
      break; // Red
    case 32:
      styles.color = "#50FA7B";
      break; // Green
    case 33:
      styles.color = "#F1FA8C";
      break; // Yellow
    case 34:
      styles.color = "#BD93F9";
      break; // Blue
    case 35:
      styles.color = "#FF79C6";
      break; // Magenta
    case 36:
      styles.color = "#8BE9FD";
      break; // Cyan
    case 37:
      styles.color = "#F8F8F2";
      break; // White
    case 90:
      styles.color = "#6272A4";
      break; // Bright Black (Gray)
    case 91:
      styles.color = "#FF6E6E";
      break; // Bright Red
    case 92:
      styles.color = "#69FF94";
      break; // Bright Green
    case 93:
      styles.color = "#FFFFA5";
      break; // Bright Yellow
    case 94:
      styles.color = "#D6ACFF";
      break; // Bright Blue
    case 95:
      styles.color = "#FF92DF";
      break; // Bright Magenta
    case 96:
      styles.color = "#A4FFFF";
      break; // Bright Cyan
    case 97:
      styles.color = "#FFFFFF";
      break; // Bright White
    default:
      break;
  }

  return styles;
};

// Parse ANSI codes and return colored segments
const parseAnsiColors = (text: string): ParsedLogLine => {
  const segments: ParsedLogLine["segments"] = [];
  let currentStyles: any = {};
  let lastIndex = 0;
  let match;
  const hasColors = ANSI_REGEX.test(text);

  // Reset regex index
  ANSI_REGEX.lastIndex = 0;

  while ((match = ANSI_REGEX.exec(text)) !== null) {
    // Add text before the ANSI code
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore) {
        segments.push({
          text: textBefore,
          ...currentStyles,
        });
      }
    }

    // Parse the ANSI code
    const ansiCode = match[0];
    const codes = ansiCode.slice(2, -1).split(";");

    for (const code of codes) {
      const newStyles = ansiToColor(code);
      if (code === "0") {
        currentStyles = {}; // Reset
      } else {
        currentStyles = { ...currentStyles, ...newStyles };
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    if (remainingText) {
      segments.push({
        text: remainingText,
        ...currentStyles,
      });
    }
  }

  // If no ANSI codes found, add the whole text as one segment
  if (segments.length === 0) {
    segments.push({ text: text.replace(ANSI_REGEX, "") });
  }

  const cleanText = text.replace(ANSI_REGEX, "");
  const levelMatch = cleanText.match(LOG_LEVEL_REGEX);

  return {
    text: cleanText,
    level: levelMatch ? levelMatch[1].toUpperCase() : undefined,
    hasColors,
    segments,
  };
};

// Get color based on log level
const getLogLevelColor = (level?: string): string => {
  switch (level) {
    case "ERROR":
    case "FATAL":
    case "CRITICAL":
      return "text-red-400";
    case "WARN":
    case "WARNING":
      return "text-yellow-400";
    case "INFO":
      return "text-blue-400";
    case "DEBUG":
    case "TRACE":
      return "text-gray-400";
    default:
      return "text-green-400";
  }
};

// Add fetchHealth utility
type HealthStatus = "healthy" | "unavailable" | "unhealthy" | "unknown";
const fetchHealth = async (deployId: string): Promise<HealthStatus> => {
  try {
    const response = await fetch(`/models-api/health/?deploy_id=${deployId}`, {
      method: "GET",
    });
    if (response.status === 200) return "healthy";
    if (response.status === 503) return "unavailable";
    return "unknown";
  } catch {
    return "unknown";
  }
};

// Add LogsDialog component
function LogsDialog({
  isOpen,
  onClose,
  containerId,
  setSelectedContainerId,
}: {
  isOpen: boolean;
  onClose: () => void;
  containerId: string;
  setSelectedContainerId: React.Dispatch<React.SetStateAction<string | null>>;
}): JSX.Element {
  console.log("LogsDialog rendered with:", { isOpen, containerId });
  const [logs, setLogs] = useState<string[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<{ [key: string]: number }>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("logs");
  const [filters, setFilters] = useState({
    showHealthChecks: true,
    showMetrics: true,
    showErrors: true,
  });

  // Filter functions
  const filterLogs = useCallback(
    (logEntry: string) => {
      if (!filters.showHealthChecks && logEntry.includes("GET /health"))
        return false;
      if (!filters.showMetrics && logEntry.includes("metrics.py")) return false;
      if (
        !filters.showErrors &&
        (logEntry.includes(" 500 ") ||
          logEntry.includes("ERROR") ||
          logEntry.includes("timeout"))
      )
        return false;
      return true;
    },
    [filters]
  );

  // Scroll to bottom logic
  const logsRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  // Helper to get the current ref based on tab
  const getCurrentRef = () => {
    if (activeTab === "logs") return logsRef;
    if (activeTab === "events") return eventsRef;
    if (activeTab === "metrics") return metricsRef;
    return logsRef;
  };

  // Scroll to bottom function with smooth behavior
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

  // Auto-scroll to bottom when new data arrives (only if auto-scroll is enabled)
  useEffect(() => {
    const currentRef = getCurrentRef();
    if (autoScrollEnabled && currentRef.current) {
      currentRef.current.scrollTop = currentRef.current.scrollHeight;
    }
  }, [logs, events, metrics, autoScrollEnabled, activeTab]);

  // Show/hide scroll button based on scroll position
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

  const eventSourceRef = useRef<EventSource | null>(null);
  const timeoutIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen || !containerId) {
      // Cleanup when dialog closes
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      setLogs([]);
      setEvents([]);
      setMetrics({});
      setError(null);
      setIsLoading(false);
      return;
    }

    // Setup when dialog opens
    setLogs([]);
    setEvents([]);
    setMetrics({});
    setError(null);
    setIsLoading(true);

    const endpoint = `/models-api/logs/${containerId}/`;
    console.log("Connecting to logs stream:", endpoint);

    timeoutIdRef.current = window.setTimeout(() => {
      if (isLoading) {
        console.warn("Log stream connection timeout after 3 seconds");
        setError("Failed to connect to log stream. Please try again.");
        setIsLoading(false);
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      }
    }, 3000);

    try {
      eventSourceRef.current = new EventSource(endpoint, {
        withCredentials: true,
      });

      const connectionEstablished = () => {
        setIsLoading(false);
        if (timeoutIdRef.current) {
          clearTimeout(timeoutIdRef.current);
          timeoutIdRef.current = null;
        }
      };

      eventSourceRef.current.onopen = () => {
        console.log("Log stream connected");
        connectionEstablished();
      };

      eventSourceRef.current.onmessage = (event) => {
        console.log("Received log:", event.data);
        connectionEstablished();
        try {
          const data = JSON.parse(event.data);
          if (data.type === "log") {
            setLogs((prevLogs) => [...prevLogs, data.message]);
          } else if (data.type === "event") {
            setEvents((prevEvents) => [...prevEvents, data.message]);
          } else if (data.type === "metric") {
            setMetrics((prevMetrics) => ({
              ...prevMetrics,
              [data.name]: data.value,
            }));
          }
        } catch (e) {
          setLogs((prevLogs) => [...prevLogs, event.data]);
        }
      };

      eventSourceRef.current.onerror = (event) => {
        console.error("Log stream error:", event);
        if (timeoutIdRef.current) {
          clearTimeout(timeoutIdRef.current);
          timeoutIdRef.current = null;
        }
        if (isLoading) {
          setError(
            "Failed to connect to log stream. The container may have stopped."
          );
        } else {
          setError(
            "Connection to log stream lost. The container may have stopped."
          );
        }
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      };
    } catch (err) {
      console.error("Error creating EventSource:", err);
      setError("Failed to create log stream connection. Please try again.");
      setIsLoading(false);
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    }

    return () => {
      console.log("Cleaning up log stream connection");
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [isOpen, containerId]);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="relative w-full">
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="metrics">Metrics</TabsTrigger>
            </TabsList>
            <TabsContent value="logs" className="mt-4">
              <div className="bg-gray-950 text-green-400 p-4 rounded-lg font-mono text-sm border border-gray-700 shadow-inner flex items-center justify-center h-32">
                <div className="flex flex-col items-center gap-2">
                  <Spinner className="w-8 h-8" />
                  <span className="text-sm">Connecting to log stream...</span>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="events" className="mt-4">
              <div className="bg-gray-950 text-blue-400 p-4 rounded-lg font-mono text-sm border border-gray-700 shadow-inner flex items-center justify-center h-32">
                <div className="flex flex-col items-center gap-2">
                  <Spinner className="w-8 h-8" />
                  <span className="text-sm">Connecting to event stream...</span>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="metrics" className="mt-4">
              <div className="bg-gray-950 text-yellow-400 p-4 rounded-lg font-mono text-sm border border-gray-700 shadow-inner flex items-center justify-center h-32">
                <div className="flex flex-col items-center gap-2">
                  <Spinner className="w-8 h-8" />
                  <span className="text-sm">
                    Connecting to metrics stream...
                  </span>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col gap-4">
          <div className="text-red-500">{error}</div>
          <Button
            onClick={() => {
              setError(null);
              setIsLoading(true);
              setSelectedContainerId(null);
              window.setTimeout(() => setSelectedContainerId(containerId), 0);
            }}
            className="bg-blue-500 hover:bg-blue-600 text-white w-32"
          >
            Retry
          </Button>
        </div>
      );
    }

    if (activeTab === "logs") {
      return (
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
            logs.filter(filterLogs).map((log, index) => {
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
                            segment.color ||
                            (parsed.level ? undefined : "#50FA7B"),
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
          {/* Terminal cursor */}
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
    }

    if (activeTab === "events") {
      return (
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
                    <span className="text-gray-500 text-xs mr-1 select-none flex-shrink-0">
                      {String(index + 1).padStart(3, "0")}
                    </span>

                    {/* Event severity icon */}
                    <span className="flex-shrink-0 mt-0.5">
                      {isError && (
                        <span className="text-red-400 text-xs">🔴</span>
                      )}
                      {isWarning && (
                        <span className="text-yellow-400 text-xs">🟡</span>
                      )}
                      {(isInfo || isStartupEvent) && (
                        <span className="text-green-400 text-xs">🟢</span>
                      )}
                      {!isError && !isWarning && !isInfo && !isStartupEvent && (
                        <span className="text-blue-400 text-xs">🔵</span>
                      )}
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
    }

    if (activeTab === "metrics") {
      return (
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
                  style={{
                    fontFamily: 'Consolas, "Courier New", monospace',
                  }}
                >
                  <span className="text-yellow-300 font-medium">
                    {name.replace(/_/g, " ").toUpperCase()}:
                  </span>
                  <span className="font-bold text-yellow-400">
                    {typeof value === "number" ? value.toLocaleString() : value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="max-w-6xl max-h-[95vh] min-w-[600px] min-h-[400px] resize flex flex-col"
        style={{ resize: "both" }}
      >
        <DialogHeader className="flex-shrink-0 pb-4 border-b border-gray-200 dark:border-gray-700">
          <DialogTitle className="flex items-center gap-2">
            <span>Container Monitoring - {containerId}</span>
            {!isLoading && !error && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-green-600 font-medium">LIVE</span>
              </div>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Fixed Filters Section */}
        <div className="flex-shrink-0 mb-4 p-4 bg-gradient-to-r from-stone-50 to-stone-100 dark:from-stone-900 dark:to-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 shadow-sm">
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
                      setFilters((prev) => ({
                        ...prev,
                        showHealthChecks: checked,
                      }))
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
                      setFilters((prev) => ({
                        ...prev,
                        showMetrics: checked,
                      }))
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
                      setFilters((prev) => ({
                        ...prev,
                        showErrors: checked,
                      }))
                    }
                    className="data-[state=checked]:bg-red-600 dark:data-[state=checked]:bg-red-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Fixed Tabs Navigation */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 min-h-0 flex flex-col"
        >
          <TabsList className="grid w-full grid-cols-3 flex-shrink-0 mb-4">
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>

          {/* Scrollable Content Area */}
          <div className="flex-1 min-h-0 overflow-auto">{renderContent()}</div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default function ModelsDeployedTable() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshTrigger, triggerRefresh, triggerHardwareRefresh } =
    useRefresh();
  const { models, setModels, refreshModels } = useModels();
  const [fadingModels, setFadingModels] = useState<string[]>([]);
  const [pulsatingModels, setPulsatingModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { theme } = useTheme();
  const [modelHealth, setModelHealth] = useState<Record<string, HealthStatus>>(
    () => ({})
  );
  const [showBanner, setShowBanner] = useState(true);
  const [bannerMinimized, setBannerMinimized] = useState(false);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(
    null
  );
  const [isRefreshingHealth, setIsRefreshingHealth] = useState(false);
  const healthBadgeRefs = useRef<Map<string, HealthBadgeRef>>(new Map());

  // Debug selectedContainerId changes
  useEffect(() => {
    console.log("selectedContainerId changed to:", selectedContainerId);
  }, [selectedContainerId]);

  // Manual health refresh function
  const refreshAllHealth = useCallback(async () => {
    console.log("Manually refreshing health for all models...");
    setIsRefreshingHealth(true);
    try {
      await Promise.all(
        Array.from(healthBadgeRefs.current.values()).map(
          (ref) => ref?.refreshHealth() ?? Promise.resolve()
        )
      );
    } finally {
      setIsRefreshingHealth(false);
    }
  }, []);

  // New state variables for column visibility
  const [showImage, setShowImage] = useState(false);
  const [showPorts, setShowPorts] = useState(true);
  const [showContainerId, setShowContainerId] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isProcessingDelete, setIsProcessingDelete] = useState(false);

  // API Info state
  const [showAPIInfo, setShowAPIInfo] = useState(false);
  const [selectedModelForAPI, setSelectedModelForAPI] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Check URL params for auto-opening logs
  useEffect(() => {
    console.log("=== URL PARAM PROCESSING EFFECT ===");
    console.log("location.search:", location.search);

    const urlParams = new URLSearchParams(location.search);
    const openLogsId = urlParams.get("openLogs");
    console.log("openLogsId from URL:", openLogsId);

    if (openLogsId) {
      console.log("Setting selectedContainerId to:", openLogsId);
      setSelectedContainerId(openLogsId);

      if (models.length > 0) {
        const modelExists = models.some((model) => model.id === openLogsId);
        console.log("Model exists in list:", modelExists);
        if (!modelExists) {
          console.warn("Model ID not found in current models:", openLogsId);
        }
      }
    }
  }, [location.search]); // Only depend on location.search, not selectedContainerId

  // Add URL cleanup effect
  useEffect(() => {
    // Clean up URL parameter when dialog is opened
    if (selectedContainerId && location.search.includes("openLogs=")) {
      console.log("Cleaning up URL parameter since dialog is now open");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [selectedContainerId, location.search]);

  const loadModels = useCallback(async () => {
    setLoadError(null);
    try {
      console.log("Fetching models...");
      const fetchedModels = await fetchModels();
      console.log("Models fetched successfully:", fetchedModels);
      setModels(fetchedModels);
      if (fetchedModels.length === 0) {
        triggerRefresh();
      }
    } catch (error) {
      console.error("Error fetching models:", error);
      let errorMessage = "Failed to fetch models. Check network connection.";
      if (error instanceof Error) {
        errorMessage = `Failed to fetch models: ${error.message}`;
      }
      setLoadError(errorMessage);
      customToast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [setModels, triggerRefresh]);

  // Retry button handler
  const handleRetry = () => {
    setLoading(true);
    loadModels();
  };

  useEffect(() => {
    loadModels();
  }, [loadModels, refreshTrigger]);

  // Fetch health for all models
  useEffect(() => {
    let isMounted = true;

    const fetchAllHealth = async () => {
      const healthStatuses: Record<string, HealthStatus> = {};
      await Promise.all(
        models.map(async (model) => {
          healthStatuses[model.id] = await fetchHealth(model.id);
        })
      );
      if (isMounted) setModelHealth(healthStatuses);
    };

    if (models.length > 0) {
      // Only do initial health check, no automatic refreshing
      fetchAllHealth();
      console.log(
        "Initial health check completed. Individual HealthBadge components will handle monitoring."
      );
    }

    return () => {
      isMounted = false;
    };
  }, [models]); // Only depend on models, not modelHealth to avoid recreating

  // Placeholder for backend reset call
  const resetCard = async () => {
    // TODO: Replace with actual backend call for tt-smi reset
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    return { success: true };
  };

  const handleDelete = (modelId: string) => {
    setDeleteTargetId(modelId);
    setShowDeleteModal(true);
    setPulsatingModels((prev) => [...prev, modelId]);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    setIsProcessingDelete(true);
    setLoadingModels((prev) => [...prev, deleteTargetId]);
    const truncatedModelId = deleteTargetId.substring(0, 4);
    try {
      await customToast.promise(deleteModel(deleteTargetId), {
        loading: `Attempting to delete Model ID: ${truncatedModelId}...`,
        success: `Model ID: ${truncatedModelId} has been deleted.`,
        error: `Failed to delete Model ID: ${truncatedModelId}.`,
      });
      await customToast.promise(resetCard(), {
        loading: "Resetting card (tt-smi reset)...",
        success: "Card reset successfully!",
        error: "Failed to reset card.",
      });
      await refreshModels();
      triggerHardwareRefresh(); // Trigger hardware refresh
      setShowDeleteModal(false);
      setDeleteTargetId(null);

      // Refresh health status after delete operation
      setTimeout(() => {
        refreshAllHealth();
      }, 1000); // Small delay to ensure backend has updated
    } catch (error) {
      setShowDeleteModal(false);
      setDeleteTargetId(null);
    } finally {
      setIsProcessingDelete(false);
      setLoadingModels((prev) => prev.filter((id) => id !== deleteTargetId));
      setPulsatingModels((prev) => prev.filter((id) => id !== deleteTargetId));
    }
  };

  // Update handleAPIInfo to navigate to the new page
  const handleAPIInfo = (modelId: string, modelName: string) => {
    console.log(
      "ModelsDeployedTable: Navigating to API info page with modelId:",
      modelId
    );
    // Ensure the modelId is properly encoded for the URL
    const encodedModelId = encodeURIComponent(modelId);
    console.log("ModelsDeployedTable: Encoded modelId:", encodedModelId);
    navigate(`/api-info/${encodedModelId}`);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setModels((prevModels) =>
        prevModels.filter((model) => !fadingModels.includes(model.id))
      );
      setFadingModels([]);
    }, 3000);
    return () => clearTimeout(timer);
  }, [fadingModels, setModels]);

  if (loading) {
    return <ModelsDeployedSkeleton />;
  }

  if (loadError) {
    return (
      <Card className="border-0 shadow-none p-8">
        <div className="flex flex-col items-center justify-center gap-4">
          <AlertCircle className="w-16 h-16 text-red-500" />
          <h2 className="text-2xl font-semibold">Connection Error</h2>
          <p className="text-center text-gray-600 dark:text-gray-300 max-w-md">
            {loadError}
          </p>
          <Button
            onClick={handleRetry}
            className="mt-4 bg-blue-500 hover:bg-blue-600 text-white"
          >
            Retry Connection
          </Button>
        </div>
      </Card>
    );
  }

  if (models.length === 0) {
    return <NoModelsDialog messageKey="reset" />;
  }

  const isLLaMAModel = (modelName: string) => {
    return modelName.toLowerCase().includes("llama");
  };

  const getModelIcon = (modelName: string) => {
    const modelType = getModelTypeFromName(modelName);
    switch (modelType) {
      case ModelType.ChatModel:
        return <MessageSquare className="w-4 h-4 mr-2" />;
      case ModelType.ImageGeneration:
        return <Image className="w-4 h-4 mr-2" />;
      case ModelType.ObjectDetectionModel:
        return <Eye className="w-4 h-4 mr-2" />;
      case ModelType.SpeechRecognitionModel:
        return <AudioLines className="w-4 h-4 mr-2" />;
      default:
        return <MessageSquare className="w-4 h-4 mr-2" />;
    }
  };

  const getModelTypeLabel = (modelName: string) => {
    const modelType = getModelTypeFromName(modelName);
    switch (modelType) {
      case ModelType.ChatModel:
        return "Chat";
      case ModelType.ImageGeneration:
        return "Image Generation";
      case ModelType.ObjectDetectionModel:
        return "Object Detection";
      case ModelType.SpeechRecognitionModel:
        return "Speech Recognition";
      default:
        return "Chat";
    }
  };

  const getTooltipText = (type: string) => {
    switch (type) {
      case "chat":
        return "Open Chat for this model";
      case "image-generation":
        return "Open Image Generation for this model";
      default:
        return `Open ${type} for this model`;
    }
  };

  return (
    <Card className="border-0 shadow-none">
      {showBanner && (
        <div className="px-6 pt-4 pb-2">
          <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50">
            <div className="flex items-start gap-3 w-full">
              <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                {!bannerMinimized && (
                  <AlertDescription className="text-blue-800 dark:text-blue-200 leading-relaxed">
                    <strong>Startup Time:</strong> Models may take 5-7 minutes
                    to start, especially on first use. Health monitoring stops
                    once models become healthy. Use the "Refresh Health" button
                    for manual updates.
                  </AlertDescription>
                )}
                {bannerMinimized && (
                  <AlertDescription className="text-blue-800 dark:text-blue-200">
                    <strong>Startup Info</strong> (click to expand)
                  </AlertDescription>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  className="p-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                  onClick={() => setBannerMinimized(!bannerMinimized)}
                  title={bannerMinimized ? "Expand" : "Minimize"}
                >
                  {bannerMinimized ? (
                    <ChevronDown className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  )}
                </button>
                <button
                  className="p-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                  onClick={() => setShowBanner(false)}
                  title="Dismiss"
                >
                  <X className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </button>
              </div>
            </div>
          </Alert>
        </div>
      )}
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Models Deployed</CardTitle>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAllHealth}
              className="flex items-center gap-2 hover:bg-blue-50 dark:hover:bg-blue-950/50"
              title="Refresh health status for all models"
              disabled={isRefreshingHealth}
            >
              {isRefreshingHealth ? (
                <Spinner className="w-4 h-4" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Refresh Health
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  Toggle Columns:
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  (click to show/hide)
                </span>
              </div>
              <div className="flex gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant={showContainerId ? "default" : "outline"}
                        className="cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
                        onClick={() => setShowContainerId(!showContainerId)}
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        Container Logs
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Show/hide container logs column</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant={showImage ? "default" : "outline"}
                        className="cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
                        onClick={() => setShowImage(!showImage)}
                      >
                        <Image className="w-3 h-3 mr-1" />
                        Docker Image
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Show/hide Docker image column</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant={showPorts ? "default" : "outline"}
                        className="cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors"
                        onClick={() => setShowPorts(!showPorts)}
                      >
                        <Network className="w-3 h-3 mr-1" />
                        Port Mappings
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Show/hide port mappings column</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <div
        className={`${!!selectedContainerId ? "blur-sm backdrop-blur-sm" : ""} transition-all duration-200`}
      >
        <CardContent className="p-0">
          <ScrollArea className="whitespace-nowrap rounded-md">
            <CustomToaster />
            <Table>
              <TableHeader>
                <TableRow
                  className={`${
                    theme === "dark"
                      ? "bg-zinc-900 rounded-lg"
                      : "bg-zinc-200 rounded-lg"
                  }`}
                >
                  {showContainerId && (
                    <TableHead className="text-left">
                      <div className="flex items-center">
                        <FileText
                          className="inline-block mr-2 text-blue-500"
                          size={16}
                        />{" "}
                        Container Logs{" "}
                        <span className="text-xs font-normal text-blue-600 dark:text-blue-400">
                          (live monitoring)
                        </span>
                      </div>
                    </TableHead>
                  )}
                  <TableHead className="text-left">
                    <Tag className="inline-block mr-2" size={16} /> Model Name
                  </TableHead>
                  {showImage && (
                    <TableHead className="text-left">
                      <div className="flex items-center">
                        <Image className="inline-block mr-2" size={16} /> Image
                      </div>
                    </TableHead>
                  )}
                  <TableHead className="text-left">
                    <Activity className="inline-block mr-2" size={16} /> Status
                  </TableHead>
                  <TableHead className="text-left">
                    <Heart className="inline-block mr-2" size={16} /> Health
                  </TableHead>
                  {showPorts && (
                    <TableHead className="text-left">
                      <div className="flex items-center">
                        <Network className="inline-block mr-2" size={16} />{" "}
                        Ports
                      </div>
                    </TableHead>
                  )}
                  <TableHead className="text-center">
                    <Settings className="inline-block mr-2" size={16} /> Manage
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((model: { id: string; [key: string]: any }) => (
                  <TableRow
                    key={model.id}
                    className={`transition-all duration-1000 ${
                      fadingModels.includes(model.id)
                        ? theme === "dark"
                          ? "bg-zinc-900 opacity-50"
                          : "bg-zinc-200 opacity-50"
                        : ""
                    } ${pulsatingModels.includes(model.id) ? "animate-pulse" : ""} rounded-lg`}
                  >
                    {showContainerId ? (
                      <TableCell className="text-left">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            console.log("=== VIEW LOGS BUTTON CLICKED ===");
                            console.log("Model ID:", model.id);
                            console.log(
                              "Current selectedContainerId before:",
                              selectedContainerId
                            );
                            setSelectedContainerId(model.id);
                            console.log(
                              "setSelectedContainerId called with:",
                              model.id
                            );
                            // Add a timeout to check if state actually updated
                            setTimeout(() => {
                              console.log(
                                "selectedContainerId after timeout:",
                                selectedContainerId
                              );
                            }, 100);
                          }}
                          className="group h-auto p-2 flex items-center gap-2 hover:bg-blue-50 dark:hover:bg-blue-950/50 hover:border-blue-300 dark:hover:border-blue-700 transition-all duration-200 min-w-[140px]"
                        >
                          <FileText className="w-4 h-4 text-blue-500" />
                          <div className="flex flex-col items-start">
                            <span className="text-xs font-mono font-medium">
                              {model.id.substring(0, 8)}...
                            </span>
                            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                              📊 View Logs
                            </span>
                          </div>
                        </Button>
                      </TableCell>
                    ) : null}
                    <TableCell className="text-left">
                      {model.name ? (
                        <CopyableText
                          text={extractShortModelName(model.name)}
                        />
                      ) : (
                        "N/A"
                      )}
                    </TableCell>
                    {showImage ? (
                      <TableCell className="text-left">
                        {model.image ? (
                          <CopyableText text={model.image} />
                        ) : (
                          "N/A"
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-left">
                      {model.status ? (
                        <StatusBadge status={model.status} />
                      ) : (
                        "N/A"
                      )}
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="inline-flex">
                        <HealthBadge
                          ref={(node) => {
                            if (node) {
                              healthBadgeRefs.current.set(model.id, node);
                            } else {
                              healthBadgeRefs.current.delete(model.id);
                            }
                          }}
                          deployId={model.id}
                          onHealthChange={(h) =>
                            setModelHealth((prev) => ({
                              ...prev,
                              [model.id]: h,
                            }))
                          }
                        />
                      </div>
                    </TableCell>
                    {showPorts ? (
                      <TableCell className="text-left">
                        {model.ports ? (
                          <CopyableText text={model.ports} />
                        ) : (
                          "N/A"
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-center">
                      <div className="flex gap-2 justify-center">
                        {fadingModels.includes(model.id) ? (
                          <Button
                            onClick={() =>
                              model.image && handleRedeploy(model.image)
                            }
                            variant="outline"
                            size="sm"
                            disabled={!model.image}
                            className="border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-600 dark:text-orange-300 dark:hover:bg-orange-950/50"
                          >
                            <RefreshCw className="w-4 h-4 mr-1" />
                            Redeploy
                          </Button>
                        ) : (
                          <>
                            {loadingModels.includes(model.id) ? (
                              <Button disabled variant="destructive" size="sm">
                                <Spinner />
                              </Button>
                            ) : (
                              <Button
                                onClick={() => handleDelete(model.id)}
                                variant="destructive"
                                size="sm"
                              >
                                <Trash2 className="w-4 h-4 mr-1" />
                                Delete
                              </Button>
                            )}
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    onClick={() =>
                                      model.name &&
                                      handleModelNavigationClick(
                                        model.id,
                                        model.name,
                                        navigate
                                      )
                                    }
                                    variant="default"
                                    size="sm"
                                    disabled={
                                      !model.name ||
                                      (modelHealth[model.id] ?? "unknown") !==
                                        "healthy"
                                    }
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                  >
                                    {getModelIcon(model.name)}
                                    {getModelTypeLabel(model.name)}
                                    {isLLaMAModel(model.name || "") && (
                                      <AlertCircle className="w-4 h-4 ml-2 text-yellow-600" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="bg-gray-700 text-white">
                                  {(modelHealth[model.id] ?? "unknown") !==
                                  "healthy" ? (
                                    <p>
                                      Action unavailable: Model health is not
                                      healthy.
                                    </p>
                                  ) : isLLaMAModel(model.name || "") ? (
                                    <p>
                                      Warning: First-time inference may take up
                                      to an hour. Subsequent runs may take 5-7
                                      minutes.
                                    </p>
                                  ) : (
                                    <p>
                                      {getTooltipText(
                                        getModelTypeLabel(model.name)
                                      )}
                                    </p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    onClick={() =>
                                      handleAPIInfo(model.id, model.name)
                                    }
                                    variant="outline"
                                    size="sm"
                                    className="flex items-center gap-1"
                                  >
                                    <Code className="w-3 h-3" />
                                    API
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>View API information and test endpoints</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ScrollBar
              className="scrollbar-thumb-rounded"
              orientation="horizontal"
            />
          </ScrollArea>
        </CardContent>
      </div>
      <LogsDialog
        isOpen={!!selectedContainerId}
        onClose={() => {
          console.log(
            "LogsDialog onClose called, setting selectedContainerId to null"
          );
          setSelectedContainerId(null);
        }}
        containerId={selectedContainerId || ""}
        setSelectedContainerId={setSelectedContainerId}
      />

      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="sm:max-w-md p-6 rounded-lg shadow-lg bg-zinc-900 text-white border border-yellow-700">
          <DialogHeader>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <AlertTriangle className="h-8 w-8 text-yellow-500 mr-2" />
                <DialogTitle className="text-lg font-semibold text-white">
                  Delete Model & Reset Card
                </DialogTitle>
              </div>
            </div>
          </DialogHeader>
          <div className="mb-4 p-4 bg-yellow-900/20 text-yellow-200 rounded-md flex items-start">
            <AlertTriangle className="h-5 w-5 text-yellow-400 mr-2 mt-1 flex-shrink-0" />
            <div>
              <div className="font-bold mb-1 text-yellow-100">
                Warning! This action will stop and remove the model, then reset
                the card.
              </div>
              <div className="text-sm text-yellow-200">
                Deleting a model will attempt to stop and remove the model
                container.
                <br />
                After deletion, the card will automatically be reset using{" "}
                <code>tt-smi reset</code>
                .<br />
                <span className="font-bold text-yellow-300">
                  This may interrupt any ongoing processes on the card.
                </span>
              </div>
            </div>
          </div>
          <DialogFooter className="mt-4 flex justify-end space-x-2">
            <Button
              onClick={() => setShowDeleteModal(false)}
              disabled={isProcessingDelete}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmDelete}
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={isProcessingDelete}
            >
              {isProcessingDelete ? "Processing..." : "Yes, Delete & Reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
