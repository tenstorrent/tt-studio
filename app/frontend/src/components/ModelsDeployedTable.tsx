// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useState, useEffect, useCallback } from "react";
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
  ChevronRight,
  ChevronLeft,
  MoreHorizontal,
  X,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

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
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isOpen || !containerId) return;

    setLogs([]);
    setError(null);
    setIsLoading(true);

    const endpoint = `/models-api/logs/${containerId}/`;
    console.log("Connecting to logs stream:", endpoint);

    let eventSource: EventSource | null = null;
    let connectionTimeoutId: NodeJS.Timeout;

    // Set a connection timeout to handle cases where onopen doesn't fire
    connectionTimeoutId = setTimeout(() => {
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

      // Some browsers don't properly implement onopen for EventSource
      // This is a fallback that will set loading to false when first message arrives
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
        // First message also means connection is established
        connectionEstablished();
        setLogs((prevLogs) => [...prevLogs, event.data]);
      };

      eventSource.onerror = (event) => {
        console.error("Log stream error:", event);
        clearTimeout(connectionTimeoutId);

        // Only show error if we haven't received any logs yet
        if (isLoading) {
          setError(
            "Failed to connect to log stream. The container may have stopped."
          );
        } else {
          setError(
            "Connection to log stream lost. The container may have stopped."
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Container Logs - {containerId}</DialogTitle>
        </DialogHeader>
        <div className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm overflow-auto max-h-[60vh]">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Spinner className="w-8 h-8" />
            </div>
          ) : error ? (
            <div className="flex flex-col gap-4">
              <div className="text-red-500">{error}</div>
              <Button
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                  setSelectedContainerId(null);
                  // Small delay before reopening to ensure clean connection
                  setTimeout(() => setSelectedContainerId(containerId), 100);
                }}
                className="bg-blue-500 hover:bg-blue-600 text-white w-32"
              >
                Retry
              </Button>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-gray-500">No logs available</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="whitespace-pre-wrap">
                {log}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ModelsDeployedTable() {
  const navigate = useNavigate();
  const { refreshTrigger, triggerRefresh } = useRefresh();
  const { models, setModels } = useModels();
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
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(
    null
  );
  // New state variables for column visibility
  const [showImage, setShowImage] = useState(false);
  const [showPorts, setShowPorts] = useState(true);
  const [modelHealth, setModelHealth] = useState<Record<string, HealthStatus>>(
    () => ({})
  );
  const [showBanner, setShowBanner] = useState(true);

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
      fetchAllHealth();
      const interval = setInterval(fetchAllHealth, 5000);
      return () => {
        isMounted = false;
        clearInterval(interval);
      };
    }
  }, [models]);

  const handleDelete = async (modelId: string) => {
    console.log(`Delete button clicked for model ID: ${modelId}`);
    const truncatedModelId = modelId.substring(0, 4);

    setPulsatingModels((prev) => [...prev, modelId]);

    const deleteModelAsync = async () => {
      setLoadingModels((prev) => [...prev, modelId]);
      try {
        const response = await deleteModel(modelId);
        const resetOutput =
          response.reset_response?.output || "No reset output available";
        console.log(`Reset Output in tsx: ${resetOutput}`);

        setFadingModels((prev) => [...prev, modelId]);

        const remainingModels = models.filter((model) => model.id !== modelId);
        if (remainingModels.length === 0) {
          triggerRefresh();
        }
      } catch (error) {
        console.error("Error stopping the container:", error);
      } finally {
        setLoadingModels((prev) => prev.filter((id) => id !== modelId));
        setPulsatingModels((prev) => prev.filter((id) => id !== modelId));
      }
    };

    customToast.promise(deleteModelAsync(), {
      loading: `Attempting to delete Model ID: ${truncatedModelId}...`,
      success: `Model ID: ${truncatedModelId} has been deleted.`,
      error: `Failed to delete Model ID: ${truncatedModelId}.`,
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
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
              <TableHead className="text-left">
                <Box className="inline-block mr-2" size={16} /> Container ID{" "}
                <span className="text-xs font-normal text-gray-500">
                  (click for logs)
                </span>
              </TableHead>
              <TableHead className={getColumnHeaderStyle(showImage)}>
                {showImage ? (
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
                ) : (
                  <div className="flex items-center justify-center">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setShowImage(true)}
                            className="p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors rotate-180"
                            title="Show Image column"
                          >
                            <ChevronLeft size={16} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p>Show Image column</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </TableHead>
              <TableHead className="text-left">
                <Activity className="inline-block mr-2" size={16} /> Status
              </TableHead>
              <TableHead className="text-left">
                <Heart className="inline-block mr-2" size={16} /> Health
              </TableHead>
              <TableHead className={getColumnHeaderStyle(showPorts)}>
                {showPorts ? (
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
                ) : (
                  <div className="flex items-center justify-center">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setShowPorts(true)}
                            className="p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors rotate-180"
                            title="Show Ports column"
                          >
                            <ChevronLeft size={16} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p>Show Ports column</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </TableHead>
              <TableHead className="text-left">
                <Tag className="inline-block mr-2" size={16} /> Names
              </TableHead>
              <TableHead className="text-left">
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
                } ${
                  pulsatingModels.includes(model.id) ? "animate-pulse" : ""
                } rounded-lg`}
              >
                <TableCell className="text-left">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setSelectedContainerId(model.id)}
                          className="text-blue-500 hover:text-blue-700 underline flex items-center"
                        >
                          <CopyableText text={model.id} />
                          <FileText className="w-4 h-4 ml-2 text-gray-500" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="bg-gray-700 text-white">
                        <p>Click to view container logs</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell className={getColumnCellStyle(showImage)}>
                  {showImage ? (
                    model.image || "N/A"
                  ) : (
                    <div className="flex justify-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <MoreHorizontal
                              size={16}
                              className="text-gray-500"
                            />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <p className="text-xs whitespace-normal">
                              {model.image || "N/A"}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-left">
                  {model.status ? <StatusBadge status={model.status} /> : "N/A"}
                </TableCell>
                <TableCell className="text-left">
                  <HealthBadge deployId={model.id} />
                </TableCell>
                <TableCell className={getColumnCellStyle(showPorts)}>
                  {showPorts ? (
                    model.ports ? (
                      <CopyableText text={model.ports} />
                    ) : (
                      "N/A"
                    )
                  ) : (
                    <div className="flex justify-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <MoreHorizontal
                              size={16}
                              className="text-gray-500"
                            />
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            <p className="text-xs">{model.ports || "N/A"}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-left">
                  {model.name ? <CopyableText text={model.name} /> : "N/A"}
                </TableCell>
                <TableCell className="text-left">
                  <div className="flex gap-2">
                    {fadingModels.includes(model.id) ? (
                      <Button
                        onClick={() =>
                          model.image && handleRedeploy(model.image)
                        }
                        className={`${
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
                            className={`${
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
                                    navigate
                                  )
                                }
                                className={`${
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
                                    getModelTypeLabel(model.name)
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
    </Card>
  );
}
