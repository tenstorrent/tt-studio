// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button } from "./ui/button";
import { StepperFormActions } from "./StepperFormActions";
import { useStepper } from "./ui/stepper";
import { useEffect, useState } from "react";
import { Progress } from "./ui/progress";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import StatusBadge from "./StatusBadge";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./ui/tooltip";
import { Loader2, Trash2, Download, XCircle, HardDrive } from "lucide-react";
import { FaDocker } from "react-icons/fa";

const dockerAPIURL = "/docker-api/";
const catalogURL = `${dockerAPIURL}catalog/`;

interface DockerStepFormProps {
  selectedModel: string | null;
  imageStatus: { exists: boolean; size: string; status: string } | null;
  pullingImage: boolean;
  pullImage: (modelId: string) => void;
  removeDynamicSteps: () => void;
  disableNext: boolean;
}

interface ModelCatalogStatus {
  model_name: string;
  model_type: string;
  image_version: string;
  exists: boolean;
  disk_usage: {
    total_gb: number;
    used_gb: number;
    free_gb: number;
  } | null;
}

interface PullProgress {
  status: string;
  progress: number;
  current: number;
  total: number;
  message?: string;
}

export function DockerStepForm({
  selectedModel,
  // imageStatus,
  pullingImage,
  pullImage,
  removeDynamicSteps,
  disableNext,
}: DockerStepFormProps) {
  const { prevStep } = useStepper();
  const [catalogStatus, setCatalogStatus] = useState<Record<string, ModelCatalogStatus>>({});
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const [ejecting, setEjecting] = useState(false);

  // Fetch catalog status and check for ongoing pulls
  useEffect(() => {
    const fetchCatalogStatus = async () => {
      try {
        const response = await fetch(catalogURL);
        const data = await response.json();
        if (data.status === "success") {
          setCatalogStatus(data.models);

          // Check if current selected model has an ongoing pull
          if (selectedModel && data.models[selectedModel]) {
            // const modelData = data.models[selectedModel];

            // Check individual image status for pull progress
            try {
              const statusResponse = await fetch(
                `${dockerAPIURL}docker/image_status/${selectedModel}/`
              );
              const statusData = await statusResponse.json();

              if (statusData.pull_in_progress && statusData.progress) {
                console.log("Resuming pull progress for", selectedModel, statusData.progress);
                setPullProgress(statusData.progress);

                // Auto-reconnect to live updates if pull is still in progress
                if (
                  statusData.progress.status === "pulling" ||
                  statusData.progress.status === "starting"
                ) {
                  console.log("Auto-reconnecting to live updates...");
                  handleReconnectToSSE();
                }
              }
            } catch (error) {
              console.error("Error checking individual image status:", error);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching catalog status:", error);
      }
    };

    fetchCatalogStatus();
    // Refresh every 30 seconds
    const interval = setInterval(fetchCatalogStatus, 30000);
    return () => clearInterval(interval);
  }, [selectedModel]);

  // Helper to refresh image status for selected model
  const refreshImageStatus = async (modelId: string) => {
    try {
      const response = await fetch(`${dockerAPIURL}docker/image_status/${modelId}/`);
      const data = await response.json();
      if (selectedModel && modelId === selectedModel) {
        setCatalogStatus((prev) => ({
          ...prev,
          [modelId]: {
            ...prev[modelId],
            exists: data.exists,
            size: data.size,
            status: data.status,
          },
        }));
      }
    } catch (error) {
      console.error("Error refreshing image status:", error);
    }
  };

  // Handle model pull with SSE
  const handlePullModel = async () => {
    if (!selectedModel) return;

    setPullProgress({
      status: "starting",
      progress: 0,
      current: 0,
      total: 0,
      message: "Starting pull...",
    });

    try {
      const response = await fetch(`${dockerAPIURL}docker/pull_image/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ model_id: selectedModel }),
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;

        // Only try to parse JSON for non-streaming responses
        if (!response.headers.get("content-type")?.includes("text/event-stream")) {
          try {
            const errorData = await response.json();
            if (errorData?.message) {
              errorMessage = errorData.message;
            }
          } catch (parseError) {
            console.error("Failed to parse error response:", parseError);
          }
        }

        if (response.status === 406) {
          throw new Error("Server cannot provide the requested content format. Please try again.");
        } else if (response.status === 404) {
          throw new Error("Model not found. Please check the model ID and try again.");
        } else if (response.status === 500) {
          throw new Error(errorMessage || "Server error while pulling model. Please try again.");
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode the chunk and add it to our buffer
        buffer += new TextDecoder().decode(value);

        // Process complete SSE messages
        const messages = buffer.split("\n\n");
        buffer = messages.pop() || ""; // Keep the last incomplete message in the buffer

        for (const message of messages) {
          if (message.startsWith("data: ")) {
            try {
              const jsonStr = message.slice(6).trim();
              if (!jsonStr) continue; // Skip empty messages

              const data = JSON.parse(jsonStr);
              setPullProgress(data);

              // If the pull is complete, refresh the catalog status and image status
              if (data.status === "success") {
                console.log("Pull completed successfully, refreshing status...");

                // Reset pull progress after a short delay to show completion
                setTimeout(() => {
                  setPullProgress(null);
                }, 2000);

                // Refresh catalog status
                const statusResponse = await fetch(catalogURL);
                const statusData = await statusResponse.json();
                if (statusData.status === "success") {
                  setCatalogStatus(statusData.models);
                }

                // Refresh image status for the selected model
                await refreshImageStatus(selectedModel);

                // Call the parent's pullImage function to update global state
                pullImage(selectedModel);
              } else if (data.status === "error") {
                console.error("Pull failed:", data.message);
                throw new Error(data.message || "Failed to pull image");
              }
            } catch (parseError) {
              console.error("Error parsing SSE data:", parseError, "Raw message:", message);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error pulling model:", error);
      setPullProgress({
        status: "error",
        progress: 0,
        current: 0,
        total: 0,
        message: error instanceof Error ? error.message : "Failed to pull image",
      });

      // Clear error message after 5 seconds
      setTimeout(() => {
        setPullProgress(null);
      }, 5000);
    }
  };

  // Handle model ejection
  const handleEjectModel = async () => {
    if (!selectedModel) return;
    setEjecting(true);

    try {
      const response = await fetch(catalogURL, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model_id: selectedModel }),
      });

      const data = await response.json();
      if (data.status === "success") {
        // Refresh catalog status and image status
        const statusResponse = await fetch(catalogURL);
        const statusData = await statusResponse.json();
        if (statusData.status === "success") {
          setCatalogStatus(statusData.models);
        }
        await refreshImageStatus(selectedModel);
      }
    } catch (error) {
      console.error("Error ejecting model:", error);
    } finally {
      setEjecting(false);
    }
  };

  // Handle pull cancellation
  const handleCancelPull = async () => {
    if (!selectedModel) return;

    try {
      const response = await fetch(`${dockerAPIURL}docker/cancel_pull/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model_id: selectedModel }),
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel pull: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.status === "success") {
        // Update UI to show cancellation
        setPullProgress({
          status: "cancelled",
          progress: 0,
          current: 0,
          total: 0,
          message: "Pull cancelled",
        });

        // Clear the progress after a short delay
        setTimeout(() => {
          setPullProgress(null);
        }, 2000);

        // Refresh the model status
        await refreshImageStatus(selectedModel);
      } else {
        throw new Error(data.message || "Failed to cancel pull");
      }
    } catch (error) {
      console.error("Error cancelling pull:", error);
      setPullProgress({
        status: "error",
        progress: 0,
        current: 0,
        total: 0,
        message: error instanceof Error ? error.message : "Failed to cancel pull",
      });
    }
  };

  // Reconnect to SSE for ongoing pulls
  const handleReconnectToSSE = async () => {
    if (!selectedModel) return;

    try {
      const response = await fetch(`${dockerAPIURL}docker/pull_image/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ model_id: selectedModel }),
      });

      if (!response.ok) {
        console.error("Failed to reconnect to SSE:", response.statusText);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += new TextDecoder().decode(value);
        const messages = buffer.split("\n\n");
        buffer = messages.pop() || "";

        for (const message of messages) {
          if (message.startsWith("data: ")) {
            try {
              const jsonStr = message.slice(6).trim();
              if (!jsonStr) continue;

              const data = JSON.parse(jsonStr);
              setPullProgress(data);

              if (data.status === "success" || data.status === "error") {
                console.log("SSE stream completed:", data.status);
                break;
              }
            } catch (parseError) {
              console.error("Error parsing SSE data:", parseError);
            }
          }
        }
      }
    } catch (error) {
      console.error("Error reconnecting to SSE:", error);
    }
  };

  const selectedModelStatus = selectedModel ? catalogStatus[selectedModel] : null;

  return (
    <div className="flex flex-col items-center w-full justify-center">
      {selectedModel ? (
        <Card className="w-full max-w-md mt-8">
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <FaDocker className="w-10 h-10 text-blue-500" />
            <CardTitle className="text-lg truncate flex-1">
              {selectedModelStatus?.model_name || selectedModel}
            </CardTitle>
            {selectedModelStatus && (
              <StatusBadge status={selectedModelStatus.exists ? "Available" : "Not Downloaded"} />
            )}
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {/* Disk Usage */}
            {selectedModelStatus?.disk_usage && (
              <div className="flex items-center gap-3">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HardDrive className="w-5 h-5 text-gray-500 dark:text-gray-300" />
                    </TooltipTrigger>
                    <TooltipContent>Disk Usage</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div className="flex-1">
                  <Progress
                    value={
                      (selectedModelStatus.disk_usage.used_gb /
                        selectedModelStatus.disk_usage.total_gb) *
                      100
                    }
                    className="w-full h-2"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>{selectedModelStatus.disk_usage.used_gb.toFixed(1)} GB</span>
                    <span>/ {selectedModelStatus.disk_usage.total_gb.toFixed(1)} GB</span>
                  </div>
                </div>
              </div>
            )}

            {/* Pull Progress */}
            {pullProgress && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-TT-purple" />
                  <span className="text-xs text-gray-500 flex-1 truncate">
                    {pullProgress.message}
                  </span>
                  <span className="text-xs text-gray-500">
                    {pullProgress.current > 0 && pullProgress.total > 0
                      ? `${Math.round((pullProgress.current / pullProgress.total) * 100)}%`
                      : `${pullProgress.progress}%`}
                  </span>
                </div>
                <Progress value={pullProgress.progress} className="w-full h-2" />
                {pullProgress.current > 0 && pullProgress.total > 0 && (
                  <div className="text-xs text-gray-400 text-right">
                    {formatBytes(pullProgress.current)} / {formatBytes(pullProgress.total)}
                  </div>
                )}
                <div className="flex gap-2 mt-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          onClick={handleCancelPull}
                          variant="destructive"
                          size="icon"
                          className="w-8 h-8 p-0"
                        >
                          <XCircle className="w-5 h-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Cancel Pull</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {(pullProgress.status === "pulling" || pullProgress.status === "starting") && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            onClick={handleReconnectToSSE}
                            variant="outline"
                            size="icon"
                            className="w-8 h-8 p-0"
                          >
                            <Loader2 className="w-4 h-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Reconnect to Live Updates</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
            )}

            {/* Error Alert (if pullProgress is error) */}
            {pullProgress?.status === "error" && (
              <Alert variant="destructive" className="mt-2">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{pullProgress.message}</AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-2">
              {!selectedModelStatus?.exists && !pullProgress && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handlePullModel}
                        disabled={pullingImage}
                        size="icon"
                        className="w-10 h-10"
                      >
                        <Download className="w-5 h-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Pull Model</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {selectedModelStatus?.exists && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleEjectModel}
                        disabled={ejecting}
                        variant="destructive"
                        size="icon"
                        className={`w-10 h-10 transition-opacity ${ejecting ? "opacity-50 cursor-not-allowed" : ""}`}
                        aria-label="Eject Model"
                      >
                        <Trash2 className="w-5 h-5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{ejecting ? "Ejecting..." : "Eject Model"}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <p>Please select a model first</p>
      )}
      {selectedModel && (
        <div className="mt-4 w-full max-w-md">
          <StepperFormActions
            removeDynamicSteps={removeDynamicSteps}
            disableNext={disableNext}
            onPrevStep={prevStep}
          />
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
