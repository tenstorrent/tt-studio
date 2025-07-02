// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "./ui/button";
import { useNavigate } from "react-router-dom";
import { checkCurrentlyDeployedModels } from "../api/modelsDeployedApis";

interface DeployedModelsWarningProps {
  className?: string;
  showNavigateButton?: boolean;
  onClose?: () => void;
  minimal?: boolean;
}

export const DeployedModelsWarning: React.FC<DeployedModelsWarningProps> = ({
  className = "",
  showNavigateButton = true,
  onClose,
  minimal = false,
}) => {
  const navigate = useNavigate();
  const [deployedInfo, setDeployedInfo] = useState<{
    hasDeployedModels: boolean;
    count: number;
    modelNames: string[];
  }>({
    hasDeployedModels: false,
    count: 0,
    modelNames: [],
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkDeployedModels = async () => {
      try {
        const info = await checkCurrentlyDeployedModels();
        setDeployedInfo(info);
      } catch (error) {
        console.error("Error checking deployed models:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkDeployedModels();
  }, []);

  const handleNavigateToDeployed = () => {
    navigate("/models-deployed");
  };

  if (isLoading || !deployedInfo.hasDeployedModels) {
    return null;
  }

  if (minimal) {
    return (
      <div
        className={`bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3 ${className}`}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <span className="text-sm text-amber-800 dark:text-amber-200">
            {deployedInfo.count} model{deployedInfo.count > 1 ? "s" : ""} already deployed
          </span>
          {showNavigateButton && (
            <Button
              variant="link"
              size="sm"
              onClick={handleNavigateToDeployed}
              className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 p-0 h-auto underline"
            >
              View
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Alert
      className={`border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 ${className}`}
    >
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle className="text-amber-800 dark:text-amber-200">
        Models Already Deployed
      </AlertTitle>
      <AlertDescription className="text-amber-700 dark:text-amber-300 space-y-2">
        <p>
          {deployedInfo.count} model{deployedInfo.count > 1 ? "s are" : " is"} currently deployed:
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          {deployedInfo.modelNames.map((name, index) => (
            <li key={index} className="truncate">
              {name}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Deploying additional models may affect system performance or require stopping existing
          deployments.
        </p>
        {showNavigateButton && (
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleNavigateToDeployed}
              className="border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-800/20"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              View Deployed Models
            </Button>
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100"
              >
                Dismiss
              </Button>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
};
