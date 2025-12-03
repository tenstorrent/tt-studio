// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { AnimatedDeployButton } from "./magicui/AnimatedDeployButton";
import { useStepper } from "./ui/stepper";
import { Weight } from "./SelectionSteps";
import { StepperFormActions } from "./StepperFormActions";
import { useModels } from "../hooks/useModels";
import { useRefresh } from "../hooks/useRefresh";
import { Cpu, Sliders, AlertTriangle, ExternalLink } from "lucide-react";
import { checkCurrentlyDeployedModels } from "../api/modelsDeployedApis";
import { Button } from "./ui/button";
import { useNavigate } from "react-router-dom";
import axios from "axios";

export function DeployModelStep({
  handleDeploy,
  selectedModel,
  selectedWeight,
  customWeight,
}: {
  selectedModel: string | null;
  selectedWeight: string | null;
  customWeight: Weight | null;
  handleDeploy: () => Promise<{ success: boolean; job_id?: string }>;
}) {
  const { nextStep } = useStepper();
  const { refreshModels } = useModels();
  const { triggerRefresh, triggerHardwareRefresh } = useRefresh();
  const navigate = useNavigate();
  const [modelName, setModelName] = useState<string | null>(null);
  const [deployedInfo, setDeployedInfo] = useState<{
    hasDeployedModels: boolean;
    count: number;
    modelNames: string[];
  }>({
    hasDeployedModels: false,
    count: 0,
    modelNames: [],
  });

  // Track deployment error state that persists even after deployment stops
  const [deploymentError, setDeploymentError] = useState<{
    hasError: boolean;
    message: string;
  }>({
    hasError: false,
    message: "",
  });

  // Track the current job_id to monitor progress
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [shouldPoll, setShouldPoll] = useState(true);

  // Add state for logs
  const [deploymentLogs, setDeploymentLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Add function to fetch logs
  const fetchDeploymentLogs = useCallback(async (jobId: string) => {
    // Toggle logs if already shown
    if (showLogs) {
      setShowLogs(false);
      return;
    }
    
    setLoadingLogs(true);
    try {
      const response = await fetch(`/docker-api/deploy/logs/${jobId}/`);
      if (response.ok) {
        const data = await response.json();
        // Format logs for display
        const formattedLogs = data.logs?.map((log: any) => {
          const timestamp = log.timestamp ? new Date(log.timestamp * 1000).toLocaleString() : '';
          return `[${timestamp}] [${log.level}] ${log.message}`;
        }) || [];
        setDeploymentLogs(formattedLogs);
        setShowLogs(true);
      }
    } catch (error) {
      console.error("Error fetching deployment logs:", error);
    } finally {
      setLoadingLogs(false);
    }
  }, [showLogs]);

  // Poll for deployment progress to detect errors
  useEffect(() => {
    if (!currentJobId || !shouldPoll) return;

    const pollProgress = async () => {
      try {
        const response = await fetch(`/docker-api/deploy/progress/${currentJobId}/`);
        if (response.ok) {
          const progressData = await response.json();
          
          if (progressData.status === 'error' || progressData.status === 'failed') {
            // Clean the error message (remove "exception:" prefix if present)
            let errorMessage = progressData.message || "Deployment failed";
            if (errorMessage.startsWith("exception: ")) {
              errorMessage = errorMessage.substring("exception: ".length);
            }
            
            setDeploymentError({
              hasError: true,
              message: errorMessage,
            });
            
            // Stop polling but keep currentJobId so user can view logs
            setShouldPoll(false);
          } else if (progressData.status === 'completed') {
            // Stop polling on completion
            setShouldPoll(false);
            setCurrentJobId(null);
          }
        }
      } catch (error) {
        console.error("Error polling deployment progress:", error);
      }
    };

    // Poll immediately
    pollProgress();
    
    // Then poll every second
    const interval = setInterval(pollProgress, 1000);

    return () => clearInterval(interval);
  }, [currentJobId, shouldPoll]);

  useEffect(() => {
    const fetchModelName = async () => {
      if (selectedModel) {
        try {
          const response = await axios.get(`/docker-api/get_containers/`);
          const models = response.data;
          const model = models.find(
            (m: { id: string; name: string }) => m.id === selectedModel
          );
          if (model) {
            setModelName(model.name);
          }
        } catch (error) {
          console.error("Error fetching model name:", error);
        }
      }
    };

    fetchModelName();
  }, [selectedModel]);

  useEffect(() => {
    const checkDeployedModels = async () => {
      try {
        const info = await checkCurrentlyDeployedModels();
        setDeployedInfo(info);
      } catch (error) {
        console.error("Error checking deployed models:", error);
      }
    };

    checkDeployedModels();
  }, []);

  const deployButtonText = useMemo(() => {
    if (deployedInfo.hasDeployedModels) {
      return "Delete Existing Models First";
    }
    if (!selectedModel) return "Select a Model";
    if (!selectedWeight && !customWeight) return "Select a Weight";
    return "Deploy Model";
  }, [
    selectedModel,
    selectedWeight,
    customWeight,
    deployedInfo.hasDeployedModels,
  ]);

  const isDeployDisabled =
    !selectedModel ||
    (!selectedWeight && !customWeight) ||
    deployedInfo.hasDeployedModels;

  const onDeploy = useCallback(async () => {
    if (isDeployDisabled) return { success: false };

    // Reset error state and polling flag when starting a new deployment
    setDeploymentError({
      hasError: false,
      message: "",
    });
    setShouldPoll(true);

    const deployResult = await handleDeploy();
    
    // Store job_id for progress tracking
    if (deployResult.job_id) {
      setCurrentJobId(deployResult.job_id);
    }
    
    if (deployResult.success) {
      // Refresh the models context
      await refreshModels();

      // Trigger a global refresh
      triggerRefresh();

      // Trigger hardware cache refresh after successful deployment
      await triggerHardwareRefresh();
    }
    return deployResult;
  }, [
    handleDeploy,
    refreshModels,
    triggerRefresh,
    triggerHardwareRefresh,
    isDeployDisabled,
  ]);

  const onDeploymentComplete = useCallback(() => {
    setTimeout(() => {
      nextStep();
    }, 650); // Short delay before moving to the next step
  }, [nextStep]);

  const handleGoToDeployedModels = () => {
    navigate("/models-deployed");
  };

  const handleRetryDeploy = () => {
    // Reset error state to allow retry
    setDeploymentError({
      hasError: false,
      message: "",
    });
    // Note: The AnimatedDeployButton will reset its state when onDeploy is called again
  };

  // Show blocking message when models are deployed
  if (deployedInfo.hasDeployedModels) {
    return (
      <>
        <div className="flex flex-col items-center justify-center p-10 space-y-6">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md text-center">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
              Cannot Deploy New Model
            </h3>
            <p className="text-red-700 dark:text-red-300 mb-4">
              {deployedInfo.count} model
              {deployedInfo.count > 1 ? "s are" : " is"} currently deployed. You
              must delete existing models before deploying a new one.
            </p>
            <div className="space-y-2 mb-4">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                Currently deployed:
              </p>
              <ul className="text-sm text-red-700 dark:text-red-300">
                {deployedInfo.modelNames.map((name, index) => (
                  <li key={index} className="truncate">
                    • {name}
                  </li>
                ))}
              </ul>
            </div>
            <Button
              onClick={handleGoToDeployedModels}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Manage Deployed Models
            </Button>
          </div>

          {/* Show selected model info but grayed out */}
          {modelName && (
            <div className="mt-6 flex flex-col items-start justify-center space-y-4 opacity-50">
              <div className="flex items-center space-x-2">
                <Cpu className="text-TT-purple-accent" />
                <span className="text-sm text-gray-800 dark:text-gray-400">
                  Selected Model:
                </span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                  {modelName}
                </span>
              </div>
              {(selectedWeight || customWeight) && (
                <div className="flex items-center space-x-2">
                  <Sliders className="text-TT-purple-accent" />
                  <span className="text-sm text-gray-800 dark:text-gray-400">
                    Selected Weight:
                  </span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                    {selectedWeight || (customWeight && customWeight.name)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <StepperFormActions removeDynamicSteps={() => {}} />
      </>
    );
  }

  return (
    <>
      <div
        className="flex flex-col items-center justify-center p-6 overflow-hidden"
        style={{ minHeight: "200px" }}
      >
        {/* Show prominent error alert when deployment fails */}
        {deploymentError.hasError && (
          <div className="w-full max-w-2xl mb-6">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
              <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
                Deployment Failed
              </h3>
              <div className="bg-white dark:bg-gray-800 border border-red-200 dark:border-red-700 rounded p-4 mb-4 max-h-48 overflow-y-auto">
                <p className="text-sm text-red-700 dark:text-red-300 text-left whitespace-pre-wrap break-words">
                  {deploymentError.message}
                </p>
              </div>
              
              {/* Add View Logs button */}
              {currentJobId && (
                <div className="mb-4">
                  <Button
                    onClick={() => fetchDeploymentLogs(currentJobId)}
                    disabled={loadingLogs}
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
                  >
                    {loadingLogs ? "Loading..." : showLogs ? "Hide API Logs" : "View API Logs"}
                  </Button>
                </div>
              )}
              
              {/* Display logs if available */}
              {showLogs && deploymentLogs.length > 0 && (
                <div className="bg-gray-950 text-green-400 p-4 rounded-lg font-mono text-xs max-h-64 overflow-y-auto text-left mb-4">
                  {deploymentLogs.map((log, index) => (
                    <div key={index} className="whitespace-pre-wrap break-words">
                      {log}
                    </div>
                  ))}
                </div>
              )}
              
              <div className="flex justify-center gap-2">
                <Button
                  onClick={handleRetryDeploy}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  Try Again
                </Button>
              </div>
            </div>
          </div>
        )}

        <AnimatedDeployButton
          initialText={<span>{deployButtonText}</span>}
          changeText={<span>Deploying Model...</span>}
          onDeploy={onDeploy}
          disabled={isDeployDisabled}
          onDeploymentComplete={onDeploymentComplete}
        />
        <div className="mt-6 flex flex-col items-start justify-center space-y-4">
          {modelName && (
            <div className="flex items-center space-x-2">
              <Cpu className="text-TT-purple-accent" />
              <span className="text-sm text-gray-800 dark:text-gray-400">
                Model:
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {modelName}
              </span>
            </div>
          )}
          {(selectedWeight || customWeight) && (
            <div className="flex items-center space-x-2">
              <Sliders className="text-TT-purple-accent" />
              <span className="text-sm text-gray-800 dark:text-gray-400">
                Weight:
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-200">
                {selectedWeight || (customWeight && customWeight.name)}
              </span>
            </div>
          )}
        </div>
      </div>
      <StepperFormActions removeDynamicSteps={() => {}} />
    </>
  );
}
