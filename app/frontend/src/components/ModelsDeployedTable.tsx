// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "./ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import { useTheme } from "../providers/ThemeProvider";
import CustomToaster, { customToast } from "./CustomToaster";
import { Spinner } from "./ui/spinner";
import CopyableText from "./CopyableText";
import StatusBadge from "./StatusBadge";
import HealthBadge from "./HealthBadge";
import {
  fetchModels,
  getModelTypeFromName,
  deleteModel,
  handleRedeploy,
  ModelType,
  handleModelNavigationClick,
  extractShortModelName,
} from "../api/modelsDeployedApis";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";
import { NoModelsDialog } from "./NoModelsDeployed";
import { ModelsDeployedSkeleton } from "./ModelsDeployedSkeleton";
import { useRefresh } from "../providers/RefreshContext";
import { useModels } from "../providers/ModelsContext";
import {
  Box,
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
  ChevronLeft,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

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
  code: string,
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
}) {
  const [logs, setLogs] = useState<string[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<{ [key: string]: number }>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("logs");

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

  useEffect(() => {
    if (!isOpen || !containerId) return;

    setLogs([]);
    setEvents([]);
    setMetrics({});
    setError(null);
    setIsLoading(true);

    const endpoint = `/models-api/logs/${containerId}/`;
    console.log("Connecting to logs stream:", endpoint);

    let eventSource: EventSource | null = null;
    let connectionTimeoutId: number;

    // Set a connection timeout to handle cases where onopen doesn't fire
    connectionTimeoutId = window.setTimeout(() => {
      if (isLoading) {
        console.warn("Log stream connection timeout after 8 seconds");
        setError("Failed to connect to log stream. Please try again.");
        eventSource?.close();
      }
    }, 8000);

    try {
      eventSource = new EventSource(endpoint, {
        withCredentials: true,
      });

      const connectionEstablished = () => {
        setIsLoading(false);
        clearTimeout(connectionTimeoutId);
      };

      eventSource.onopen = () => {
        console.log("Log stream connected");
        connectionEstablished();
      };

      eventSource.onmessage = (event) => {
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
          // If parsing fails, treat as a regular log
          setLogs((prevLogs) => [...prevLogs, event.data]);
        }
      };

      eventSource.onerror = (event) => {
        console.error("Log stream error:", event);
        clearTimeout(connectionTimeoutId);

        if (isLoading) {
          setError(
            "Failed to connect to log stream. The container may have stopped.",
          );
        } else {
          setError(
            "Connection to log stream lost. The container may have stopped.",
          );
        }

        eventSource?.close();
      };
    } catch (err) {
      console.error("Error creating EventSource:", err);
      setError("Failed to create log stream connection. Please try again.");
      setIsLoading(false);
    }

    return () => {
      console.log("Cleaning up log stream connection");
      clearTimeout(connectionTimeoutId);
      eventSource?.close();
    };
  }, [isOpen, containerId]);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-32">
          <Spinner className="w-8 h-8" />
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
              window.setTimeout(() => setSelectedContainerId(containerId), 100);
            }}
            className="bg-blue-500 hover:bg-blue-600 text-white w-32"
          >
            Retry
          </Button>
        </div>
      );
    }

    return (
      <div className="relative w-full">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>
          <TabsContent value="logs" className="mt-4">
            <div
              ref={logsRef}
              onScroll={handleScroll}
              className="bg-gray-950 text-green-400 p-4 rounded-lg font-mono text-sm overflow-auto max-h-[50vh] relative border border-gray-700 shadow-inner"
              style={{
                minHeight: 200,
                lineHeight: "1.5",
                scrollBehavior: "smooth",
                fontFamily:
                  'Consolas, "Monaco", "Lucida Console", "Liberation Mono", "DejaVu Sans Mono", "Bitstream Vera Sans Mono", "Courier New", monospace',
              }}
            >
              {logs.length === 0 ? (
                <div className="text-gray-500 italic">
                  No logs available - waiting for container output...
                </div>
              ) : (
                logs.map((log, index) => {
                  const parsed = parseAnsiColors(log);
                  return (
                    <div
                      key={index}
                      className="whitespace-pre-wrap leading-relaxed py-0.5 hover:bg-gray-900 hover:bg-opacity-30 transition-colors duration-150 group"
                      style={{
                        wordWrap: "break-word",
                        overflowWrap: "break-word",
                        fontFamily:
                          'Consolas, "Courier New", "Monaco", monospace',
                      }}
                    >
                      <span className="text-gray-500 text-xs mr-2 select-none">
                        {String(index + 1).padStart(3, "0")}
                      </span>
                      {parsed.level && (
                        <span
                          className={`text-xs font-bold mr-2 ${getLogLevelColor(
                            parsed.level,
                          )}`}
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
                  <span className="text-gray-500 text-xs mr-2 select-none">
                    $
                  </span>
                  <span className="text-green-400 animate-pulse text-sm">
                    █
                  </span>
                </div>
              )}
            </div>
            {showScrollButton && (
              <button
                onClick={scrollToBottom}
                className="fixed bottom-8 right-8 z-50 bg-blue-600 text-white rounded-full p-2 shadow-lg"
                title="Scroll to bottom"
              >
                <ChevronDown className="w-6 h-6" />
              </button>
            )}
          </TabsContent>
          <TabsContent value="events" className="mt-4">
            <div
              ref={eventsRef}
              onScroll={handleScroll}
              className="bg-gray-950 text-blue-400 p-4 rounded-lg font-mono text-sm overflow-auto max-h-[50vh] relative border border-gray-700 shadow-inner"
              style={{
                minHeight: 200,
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
                  const isInfo =
                    parsed.level && ["INFO"].includes(parsed.level);
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
                        fontFamily:
                          'Consolas, "Courier New", "Monaco", monospace',
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
                          {!isError &&
                            !isWarning &&
                            !isInfo &&
                            !isStartupEvent && (
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
                                  fontStyle: segment.italic
                                    ? "italic"
                                    : "normal",
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
          </TabsContent>
          <TabsContent value="metrics" className="mt-4">
            <div
              ref={metricsRef}
              onScroll={handleScroll}
              className="bg-gray-950 text-yellow-400 p-4 rounded-lg font-mono text-sm overflow-auto max-h-[50vh] relative border border-gray-700 shadow-inner"
              style={{
                minHeight: 200,
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
                        {typeof value === "number"
                          ? value.toLocaleString()
                          : value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] min-w-[400px] min-h-[300px] resize both overflow-auto">
        <DialogHeader>
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
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}

export default function ModelsDeployedTable() {
  const navigate = useNavigate();
  const { refreshTrigger, triggerRefresh, triggerHardwareRefresh } = useRefresh();
  const { models, setModels, refreshModels } = useModels();
  const [fadingModels, setFadingModels] = useState<string[]>([]);
  const [pulsatingModels, setPulsatingModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { theme } = useTheme();
  const [modelHealth, setModelHealth] = useState<Record<string, HealthStatus>>(
    () => ({}),
  );
  const [showBanner, setShowBanner] = useState(true);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(
    null,
  );
  // New state variables for column visibility
  const [showImage, setShowImage] = useState(false);
  const [showPorts, setShowPorts] = useState(true);
  const [showContainerId, setShowContainerId] = useState(true);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isProcessingDelete, setIsProcessingDelete] = useState(false);

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
        }),
      );
      if (isMounted) setModelHealth(healthStatuses);
    };
    if (models.length > 0) {
      fetchAllHealth();
      // No more timer-based polling - health will be checked when models change
    }
    return () => {
      isMounted = false;
    };
  }, [models]);

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
    } catch (error) {
      setShowDeleteModal(false);
      setDeleteTargetId(null);
    } finally {
      setIsProcessingDelete(false);
      setLoadingModels((prev) => prev.filter((id) => id !== deleteTargetId));
      setPulsatingModels((prev) => prev.filter((id) => id !== deleteTargetId));
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setModels((prevModels) =>
        prevModels.filter((model) => !fadingModels.includes(model.id)),
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

  // Add function for styling collapsed columns
  const getColumnHeaderStyle = (isVisible: boolean) => {
    return isVisible
      ? "text-left"
      : "text-left w-10 bg-gradient-to-r from-transparent to-zinc-800 dark:to-zinc-900 opacity-70";
  };

  const getColumnCellStyle = (isVisible: boolean) => {
    return isVisible ? "text-left" : "text-left w-10 px-1";
  };

  return (
    <Card className="border-0 shadow-none">
      {showBanner && (
        <div className="relative flex items-center justify-between mb-4 p-4 rounded-lg shadow-md bg-gradient-to-r from-[#7C68FA] to-[#6C54E8] text-white dark:from-[#7C68FA] dark:to-[#6C54E8] dark:text-white">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 mr-2 text-purple-200 dark:text-purple-200"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z"
              />
            </svg>
            <span>
              Note: Some models may take up to <b>5–7 minutes</b> to start up,
              especially on first use. Please be patient if the health status is
              not yet 'healthy'.
            </span>
          </div>
          <button
            className="ml-4 p-1 rounded hover:bg-[#6C54E8]/80 transition-colors"
            aria-label="Dismiss notification"
            onClick={() => setShowBanner(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
      <ScrollArea className="whitespace-nowrap rounded-md">
        <CustomToaster />
        <Table>
          <TableCaption className="text-TT-black dark:text-TT-white text-xl">
            Models Deployed
          </TableCaption>
          <TableHeader>
            <TableRow
              className={`${
                theme === "dark"
                  ? "bg-zinc-900 rounded-lg"
                  : "bg-zinc-200 rounded-lg"
              }`}
            >
              {showContainerId && (
                <TableHead className={getColumnHeaderStyle(showContainerId)}>
                  <div className="flex items-center">
                    <Box className="inline-block mr-2" size={16} /> Container ID{" "}
                    <span className="text-xs font-normal text-gray-500">
                      (click for logs)
                    </span>
                    <button
                      onClick={() => setShowContainerId(false)}
                      className="ml-2 p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                      title="Hide column"
                    >
                      <ChevronLeft size={16} />
                    </button>
                  </div>
                </TableHead>
              )}
              <TableHead className="text-left">
                <Tag className="inline-block mr-2" size={16} /> Model Name
              </TableHead>
              {showImage && (
                <TableHead className={getColumnHeaderStyle(showImage)}>
                  <div className="flex items-center">
                    <Image className="inline-block mr-2" size={16} /> Image
                    <button
                      onClick={() => setShowImage(false)}
                      className="ml-2 p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                      title="Hide column"
                    >
                      <ChevronLeft size={16} />
                    </button>
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
                <TableHead className={getColumnHeaderStyle(showPorts)}>
                  <div className="flex items-center">
                    <Network className="inline-block mr-2" size={16} /> Ports
                    <button
                      onClick={() => setShowPorts(false)}
                      className="ml-2 p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                      title="Hide column"
                    >
                      <ChevronLeft size={16} />
                    </button>
                  </div>
                </TableHead>
              )}
              <TableHead className="text-center">
                <Settings className="inline-block mr-2" size={16} /> Manage
              </TableHead>
              {/* Always-visible show column buttons for hidden columns */}
              {(!showContainerId || !showImage || !showPorts) && (
                <TableHead className="text-right bg-transparent border-0">
                  <div className="flex gap-2 justify-end items-center">
                    {!showContainerId && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setShowContainerId(true)}
                              className="p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                              title="Show Container ID column"
                            >
                              <Box size={16} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>Show Container ID column</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {!showImage && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setShowImage(true)}
                              className="p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                              title="Show Image column"
                            >
                              <Image size={16} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>Show Image column</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {!showPorts && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => setShowPorts(true)}
                              className="p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
                              title="Show Ports column"
                            >
                              <Network size={16} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            <p>Show Ports column</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </TableHead>
              )}
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
                } ${
                  pulsatingModels.includes(model.id) ? "animate-pulse" : ""
                } rounded-lg`}
              >
                {showContainerId ? (
                  <TableCell className="text-left">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setSelectedContainerId(model.id)}
                            className="text-blue-500 hover:text-blue-700 underline flex items-center"
                          >
                            <CopyableText
                              text={model.id}
                              isInsideButton={true}
                            />
                            <FileText className="w-4 h-4 ml-2 text-gray-500" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="bg-gray-700 text-white">
                          <p>Click to view container logs</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                ) : null}
                <TableCell className="text-left">
                  {model.name ? (
                    <CopyableText text={extractShortModelName(model.name)} />
                  ) : (
                    "N/A"
                  )}
                </TableCell>
                {showImage ? (
                  <TableCell className="text-left">
                    {model.image ? <CopyableText text={model.image} /> : "N/A"}
                  </TableCell>
                ) : null}
                <TableCell className="text-left">
                  {model.status ? <StatusBadge status={model.status} /> : "N/A"}
                </TableCell>
                <TableCell className="text-left">
                  <HealthBadge deployId={model.id} />
                </TableCell>
                {showPorts ? (
                  <TableCell className={getColumnCellStyle(showPorts)}>
                    {model.ports ? <CopyableText text={model.ports} /> : "N/A"}
                  </TableCell>
                ) : null}
                <TableCell className="text-center">
                  <div className="flex gap-2 justify-center">
                    {fadingModels.includes(model.id) ? (
                      <Button
                        onClick={() =>
                          model.image && handleRedeploy(model.image)
                        }
                        className={`$${
                          theme === "light"
                            ? "bg-zinc-700 hover:bg-zinc-600 text-white"
                            : "bg-zinc-600 hover:bg-zinc-500 text-white"
                        } rounded-lg`}
                        disabled={!model.image}
                      >
                        Redeploy
                      </Button>
                    ) : (
                      <>
                        {loadingModels.includes(model.id) ? (
                          <Button
                            disabled
                            className={`$${
                              theme === "dark"
                                ? "bg-red-700 hover:bg-red-600 text-white"
                                : "bg-red-500 hover:bg-red-400 text-white"
                            } rounded-lg`}
                          >
                            <Spinner />
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleDelete(model.id)}
                            className="bg-red-700 dark:bg-red-600 hover:bg-red-500 dark:hover:bg-red-500 text-white rounded-lg"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
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
                                    navigate,
                                  )
                                }
                                className={`$${
                                  theme === "dark"
                                    ? "bg-blue-500 dark:bg-blue-700 hover:bg-blue-400 dark:hover:bg-blue-600 text-white"
                                    : "bg-blue-500 hover:bg-blue-400 text-white"
                                } rounded-lg`}
                                disabled={
                                  !model.name ||
                                  (modelHealth[model.id] ?? "unknown") !==
                                    "healthy"
                                }
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
                                  Warning: First-time inference may take up to
                                  an hour. Subsequent runs may take 5-7 minutes.
                                </p>
                              ) : (
                                <p>
                                  {getTooltipText(
                                    getModelTypeLabel(model.name),
                                  )}
                                </p>
                              )}
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
      <LogsDialog
        isOpen={!!selectedContainerId}
        onClose={() => setSelectedContainerId(null)}
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

/* Add this to the bottom of the file or in a global CSS file if not already present */
/*
.resizable-dialog {
  resize: both;
  overflow: auto;
  min-width: 400px;
  min-height: 300px;
  max-width: 90vw;
  max-height: 90vh;
}
*/
