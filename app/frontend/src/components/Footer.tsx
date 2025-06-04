// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Badge } from "./ui/badge";
import { useTheme } from "../providers/ThemeProvider";

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
  error?: string;
}

const Footer: React.FC<FooterProps> = ({ className }) => {
  const { theme } = useTheme();
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    cpuUsage: 0,
    memoryUsage: 0,
    memoryTotal: "0 GB",
    boardName: "Loading...",
    temperature: 0,
    devices: [],
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
        boardName: "Error",
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchSystemStatus();

    // Set up polling every 5 seconds
    const interval = setInterval(fetchSystemStatus, 5000);

    // Cleanup interval on unmount
    return () => clearInterval(interval);
  }, []);

  const textColor = theme === "dark" ? "text-zinc-300" : "text-gray-700";
  const borderColor = theme === "dark" ? "border-zinc-700" : "border-gray-200";
  const bgColor = theme === "dark" ? "bg-zinc-900/95" : "bg-white/95";
  const mutedTextColor = theme === "dark" ? "text-zinc-400" : "text-gray-500";

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
            <span className={`text-sm ${mutedTextColor}`}>
              LOADING SYSTEM RESOURCES...
            </span>
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
            variant={error ? "destructive" : "default"}
            className="text-xs"
          >
            {systemStatus.boardName}
          </Badge>
          {error && (
            <span className={`text-xs text-red-500`} title={error}>
              ⚠️
            </span>
          )}
        </div>

        {/* Right Section - System Resources & Controls */}
        <div className="flex items-center space-x-4">
          <span className={`text-sm ${mutedTextColor}`}>
            SYSTEM RESOURCES USAGE:
          </span>
          <span className={`text-sm ${textColor}`}>
            RAM: {systemStatus.memoryUsage.toFixed(1)}% (
            {systemStatus.memoryTotal}) | CPU:{" "}
            {systemStatus.cpuUsage.toFixed(2)}% | TEMP:{" "}
            {systemStatus.temperature.toFixed(1)}°C
          </span>
          {systemStatus.devices.length > 1 && (
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
