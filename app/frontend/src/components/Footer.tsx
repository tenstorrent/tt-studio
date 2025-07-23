// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Badge } from "./ui/badge";
import { useTheme } from "../hooks/useTheme";
import { useNavigate } from "react-router-dom";
import { useModels } from "../hooks/useModels";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

interface FooterProps {
  className?: string;
}

interface SystemStatus {
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: string;
  boardName: string;
  temperature: number;
  devices: Array<{
    index: number;
    board_type: string;
    temperature: number;
    power: number;
    voltage: number;
  }>;
  hardware_status?: "healthy" | "error" | "unknown";
  hardware_error?: string;
  error?: string;
}

const Footer: React.FC<FooterProps> = ({ className }) => {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { models } = useModels(); // Use models from context
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    cpuUsage: 0,
    memoryUsage: 0,
    memoryTotal: "0 GB",
    boardName: "Loading...",
    temperature: 0,
    devices: [],
    hardware_status: "unknown",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch system status from API
  const fetchSystemStatus = async () => {
    try {
      const response = await fetch("/board-api/footer-data/");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Expected application/json but got ${contentType}`);
      }

      const data = await response.json();
      setSystemStatus(data);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch system status:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      // Keep previous data or use fallback
      setSystemStatus((prev) => ({
        ...prev,
        boardName: prev.hardware_status === "error" ? prev.boardName : "Error",
        hardware_status: prev.hardware_status === "error" ? "error" : "unknown",
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch on mount only
    fetchSystemStatus();

    // No more timer-based polling - will refresh on model deployment events
  }, []);

  const textColor = theme === "dark" ? "text-zinc-300" : "text-gray-700";
  const borderColor = theme === "dark" ? "border-zinc-700" : "border-gray-200";
  const bgColor = theme === "dark" ? "bg-zinc-900/95" : "bg-white/95";
  const mutedTextColor = theme === "dark" ? "text-zinc-400" : "text-gray-500";

  // Handle click on deployed models section
  const handleDeployedModelsClick = () => {
    navigate("/models-deployed");
  };

  // Create deployed models display text using models from context
  const getDeployedModelsText = () => {
    if (models.length === 0) {
      return "No models deployed";
    } else if (models.length === 1) {
      return `${models[0].name || "Unknown Model"}`;
    } else {
      return `${models.length} models deployed`;
    }
  };

  // Show loading state
  if (loading) {
    return (
      <motion.footer
        className={`fixed bottom-0 left-0 right-0 z-50 ${bgColor} backdrop-blur-sm border-t ${borderColor} ${className}`}
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center space-x-3">
            <span className={`text-sm ${textColor}`}>TT Studio 0.3.11</span>
            <Badge variant="default" className="text-xs">
              Loading...
            </Badge>
          </div>
          <div className="flex items-center space-x-4">
            <span className={`text-sm ${mutedTextColor}`}>LOADING SYSTEM RESOURCES...</span>
          </div>
        </div>
      </motion.footer>
    );
  }

  return (
    <motion.footer
      className={`fixed bottom-0 left-0 right-0 z-50 ${bgColor} backdrop-blur-sm border-t ${borderColor} ${className}`}
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <div className="flex items-center justify-between px-4 py-2">
        {/* Left Section - App Info & Board */}
        <div className="flex items-center space-x-3">
          <span className={`text-sm ${textColor}`}>TT Studio 1.5.0</span>
          <Badge
            variant={
              systemStatus.hardware_status === "error"
                ? "destructive"
                : error
                  ? "destructive"
                  : "default"
            }
            className={`text-xs ${textColor}`}
            title={systemStatus.hardware_error || error || "Hardware status"}
          >
            {systemStatus.boardName}
            {systemStatus.hardware_status === "error" && " ⚠️"}
          </Badge>
          {(error || systemStatus.hardware_error) && (
            <span
              className={`text-xs text-red-500`}
              title={systemStatus.hardware_error || error || "System error"}
            >
              ⚠️
            </span>
          )}

          {/* Deployed Models Section */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="inline-block">
                  <Badge
                    variant={models.length > 0 ? "default" : "outline"}
                    className={`text-xs cursor-pointer transition-colors hover:bg-opacity-80 ${
                      models.length > 0
                        ? "bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900 dark:text-green-100 dark:hover:bg-green-800"
                        : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                    onClick={handleDeployedModelsClick}
                  >
                    📟 {getDeployedModelsText()}
                  </Badge>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {models.length > 0
                    ? `Click to view ${models.length} deployed model${
                        models.length > 1 ? "s" : ""
                      }${models.length === 1 ? `: ${models[0].name || "Unknown Model"}` : ""}`
                    : "Click to view deployed models page"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Right Section - System Resources & Controls */}
        <div className="flex items-center space-x-4">
          <span className={`text-sm ${mutedTextColor}`}>SYSTEM RESOURCES USAGE:</span>
          <span className={`text-sm ${textColor}`}>
            RAM: {systemStatus.memoryUsage.toFixed(1)}% ({systemStatus.memoryTotal}) | CPU:{" "}
            {systemStatus.cpuUsage.toFixed(2)}%
            {systemStatus.hardware_status === "healthy" && (
              <> | TEMP: {systemStatus.temperature.toFixed(1)}°C</>
            )}
            {systemStatus.hardware_status === "error" && <> | TT HARDWARE: UNAVAILABLE</>}
            {systemStatus.hardware_status === "unknown" && <> | TT HARDWARE: CHECKING...</>}
          </span>
          {systemStatus.devices.length > 1 && systemStatus.hardware_status === "healthy" && (
            <span className={`text-xs ${mutedTextColor}`}>
              ({systemStatus.devices.length} devices)
            </span>
          )}
        </div>
      </div>
    </motion.footer>
  );
};

export default Footer;
