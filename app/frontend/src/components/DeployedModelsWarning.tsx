// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
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
  const [isCollapsed, setIsCollapsed] = useState(false);

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
            {deployedInfo.count} model{deployedInfo.count > 1 ? "s" : ""}{" "}
            already deployed
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
      className={`border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 ${className} pt-6 pb-4 px-6 text-left`}
    >
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <AlertTitle className="text-amber-800 dark:text-amber-200 m-0 text-left">
            Models Already Deployed
          </AlertTitle>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 p-1 h-auto"
        >
          {isCollapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </Button>
      </div>

      {!isCollapsed && (
        <AlertDescription className="text-amber-700 dark:text-amber-300 space-y-4 mt-6 text-left">
          <div className="flex items-center gap-3 text-left">
            <span>
              {deployedInfo.count} model
              {deployedInfo.count > 1 ? "s are" : " is"} currently deployed:
            </span>
            {deployedInfo.count === 1 && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700">
                {deployedInfo.modelNames[0]}
              </span>
            )}
          </div>
          {deployedInfo.count > 1 && (
            <div className="bg-amber-50 dark:bg-amber-900/10 rounded-md p-4 border border-amber-200 dark:border-amber-800 text-left">
              <ul className="space-y-2">
                {deployedInfo.modelNames.map((name, index) => (
                  <li
                    key={index}
                    className="flex items-center gap-2 text-sm text-left"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 dark:bg-amber-500 flex-shrink-0"></div>
                    <span className="truncate font-medium">{name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm leading-relaxed text-left">
            Deploying additional models may affect system performance or require
            stopping existing deployments.
          </p>
          {showNavigateButton && (
            <div className="flex gap-2 pt-3 text-left">
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
      )}
    </Alert>
  );
};
