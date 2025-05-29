import { Button } from "./ui/button";
import { StepperFormActions } from "./StepperFormActions";
import { useStepper } from "./ui/stepper";
import { useEffect, useState } from "react";
import { Progress } from "./ui/progress";

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
  imageStatus,
  pullingImage,
  pullImage,
  removeDynamicSteps,
  disableNext,
}: DockerStepFormProps) {
  const { prevStep } = useStepper();
  const [catalogStatus, setCatalogStatus] = useState<
    Record<string, ModelCatalogStatus>
  >({});
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const [ejecting, setEjecting] = useState(false);

  // Fetch catalog status
  useEffect(() => {
    const fetchCatalogStatus = async () => {
      try {
        const response = await fetch(catalogURL);
        const data = await response.json();
        if (data.status === "success") {
          setCatalogStatus(data.models);
        }
      } catch (error) {
        console.error("Error fetching catalog status:", error);
      }
    };

    fetchCatalogStatus();
    // Refresh every 30 seconds
    const interval = setInterval(fetchCatalogStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Helper to refresh image status for selected model
  const refreshImageStatus = async (modelId: string) => {
    try {
      const response = await fetch(
        `${dockerAPIURL}docker/image_status/${modelId}/`
      );
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
      message: "Starting pull..."
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
        if (!response.headers.get('content-type')?.includes('text/event-stream')) {
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
          throw new Error(
            "Server cannot provide the requested content format. Please try again."
          );
        } else if (response.status === 404) {
          throw new Error(
            "Model not found. Please check the model ID and try again."
          );
        } else if (response.status === 500) {
          throw new Error(
            errorMessage || "Server error while pulling model. Please try again."
          );
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode the chunk and add it to our buffer
        buffer += new TextDecoder().decode(value);
        
        // Process complete SSE messages
        const messages = buffer.split('\n\n');
        buffer = messages.pop() || ''; // Keep the last incomplete message in the buffer
        
        for (const message of messages) {
          if (message.startsWith('data: ')) {
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
        message:
          error instanceof Error ? error.message : "Failed to pull image",
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
          message: "Pull cancelled"
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
        message: error instanceof Error ? error.message : "Failed to cancel pull"
      });
    }
  };

  const selectedModelStatus = selectedModel
    ? catalogStatus[selectedModel]
    : null;

  return (
    <div className="flex flex-col items-center w-full justify-center p-10">
      {selectedModel ? (
        <div className="w-full max-w-md">
          <div className="mb-4">
            <h3 className="text-lg font-semibold mb-2">Model Status</h3>
            {selectedModelStatus ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p>Model: {selectedModelStatus.model_name}</p>
                  <p>Type: {selectedModelStatus.model_type}</p>
                  <p>Version: {selectedModelStatus.image_version}</p>
                  <p>
                    Status:{" "}
                    {selectedModelStatus.exists
                      ? "Available"
                      : "Not Downloaded"}
                  </p>
                </div>

                {selectedModelStatus.disk_usage && (
                  <div className="space-y-2">
                    <h4 className="font-medium">Disk Usage</h4>
                    <div className="space-y-1">
                      <p>
                        Total:{" "}
                        {selectedModelStatus.disk_usage.total_gb.toFixed(2)} GB
                      </p>
                      <p>
                        Used:{" "}
                        {selectedModelStatus.disk_usage.used_gb.toFixed(2)} GB
                      </p>
                      <p>
                        Free:{" "}
                        {selectedModelStatus.disk_usage.free_gb.toFixed(2)} GB
                      </p>
                      <Progress
                        value={
                          (selectedModelStatus.disk_usage.used_gb /
                            selectedModelStatus.disk_usage.total_gb) *
                          100
                        }
                        className="w-full"
                      />
                    </div>
                  </div>
                )}

                {pullProgress && (
                  <div className="space-y-2">
                    <h4 className="font-medium">Pull Progress</h4>
                    <div className="space-y-1">
                      <Progress
                        value={pullProgress.progress}
                        className="w-full"
                      />
                      <div className="flex justify-between text-sm text-gray-500">
                        <span>{pullProgress.message}</span>
                        <span>
                          {pullProgress.current > 0 && pullProgress.total > 0
                            ? `${Math.round((pullProgress.current / pullProgress.total) * 100)}%`
                            : `${pullProgress.progress}%`}
                        </span>
                      </div>
                      {pullProgress.current > 0 && pullProgress.total > 0 && (
                        <div className="text-sm text-gray-500">
                          {formatBytes(pullProgress.current)} / {formatBytes(pullProgress.total)}
                        </div>
                      )}
                    </div>
                    <Button
                      onClick={handleCancelPull}
                      variant="destructive"
                      className="w-full"
                    >
                      Cancel Pull
                    </Button>
                  </div>
                )}

                <div className="flex gap-2">
                  {!selectedModelStatus.exists && !pullProgress && (
                    <Button
                      onClick={handlePullModel}
                      disabled={pullingImage}
                      className="flex-1"
                    >
                      {pullingImage ? "Pulling..." : "Pull Model"}
                    </Button>
                  )}

                  {selectedModelStatus.exists && (
                    <Button
                      onClick={handleEjectModel}
                      disabled={ejecting}
                      variant="destructive"
                      className="flex-1"
                    >
                      {ejecting ? "Ejecting..." : "Eject Model"}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p>Loading status...</p>
            )}
          </div>
          <StepperFormActions
            removeDynamicSteps={removeDynamicSteps}
            disableNext={disableNext}
            onPrevStep={prevStep}
          />
        </div>
      ) : (
        <p>Please select a model first</p>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
