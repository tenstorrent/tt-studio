// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Badge } from "./ui/badge";
import { useTheme } from "../hooks/useTheme";
import { useNavigate, useLocation } from "react-router-dom";
import { useModels } from "../hooks/useModels";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import {
  ExternalLink,
  Github,
  Package,
  Info,
  FileText,
  RefreshCw,
  Bug,
} from "lucide-react";
import { useGitHubReleases } from "../hooks/useGitHubReleases";
import { HardwareIcon } from "./aiPlaygroundHome/HardwareIcon";

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

const REFRESH_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes cooldown between manual refreshes

const Footer: React.FC<FooterProps> = ({ className }) => {
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    cpuUsage: 0,
    memoryUsage: 0,
    memoryTotal: "0 GB",
    boardName: "Unknown",
    temperature: 0,
    devices: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshTime = useRef<number | null>(null);
  const [showTTStudioModal, setShowTTStudioModal] = useState(false);
  const [bugReportLoading, setBugReportLoading] = useState(false);
  const { models } = useModels();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const {
    releaseInfo,
    parsedNotes,
    formattedDate,
    loading: releasesLoading,
    error: releasesError,
    refetch,
  } = useGitHubReleases();

  // Check if we should hide the footer
  const shouldHideFooter = location.pathname === "/chat";

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

  const getRemainingCooldownMs = () => {
    if (!lastRefreshTime.current) return 0;
    return Math.max(
      REFRESH_COOLDOWN_MS - (Date.now() - lastRefreshTime.current),
      0
    );
  };

  const handleRefreshBoardDetection = async () => {
    const remaining = getRemainingCooldownMs();
    if (remaining > 0 || refreshing) {
      return;
    }

    try {
      setRefreshing(true);
      const response = await fetch("/board-api/refresh-cache/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      await fetchSystemStatus();
    } catch (err) {
      console.error("Failed to refresh board detection:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      lastRefreshTime.current = Date.now();
      setRefreshing(false);
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
  const normalizedBoardName = systemStatus.boardName?.toLowerCase();
  const isBoardDetectionIssue =
    systemStatus.hardware_status === "error" ||
    !!error ||
    normalizedBoardName === "error" ||
    normalizedBoardName === "unknown";
  const remainingCooldownMs = getRemainingCooldownMs();
  const isInCooldown = remainingCooldownMs > 0;
  const cooldownSeconds = Math.ceil(remainingCooldownMs / 1000);

  // Handle click on deployed models section
  const handleDeployedModelsClick = () => {
    navigate("/models-deployed");
  };

  // Handle logs button click
  const handleLogsClick = () => {
    console.log("=== FOOTER LOGS BUTTON CLICKED ===");
    console.log("Available models:", models);
    if (models.length > 0) {
      console.log("Footer: Opening logs for model ID:", models[0].id);
      console.log("Footer: Model name:", models[0].name);
      const targetUrl = `/models-deployed?openLogs=${models[0].id}`;
      console.log("Footer: Navigating to:", targetUrl);
      navigate(targetUrl);
    } else {
      console.log("Footer: No models available, navigating to models page");
      navigate("/models-deployed");
    }
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

  // Function to generate bug report with system information
  const generateBugReport = async () => {
    const currentVersion = releaseInfo?.currentVersion || "2.0.1";
    const currentUrl = window.location.href;
    const userAgent = navigator.userAgent;

    // Fetch FastAPI logs
    let fastapiLogs = "Failed to fetch FastAPI logs";
    try {
      const fastapiResponse = await fetch("/logs-api/fastapi/");
      if (fastapiResponse.ok) {
        const fastapiData = await fastapiResponse.json();
        fastapiLogs = fastapiData.fastapi_logs || "No FastAPI logs available";
      }
    } catch (err) {
      console.error("Failed to fetch FastAPI logs:", err);
      fastapiLogs =
        "Error fetching FastAPI logs: " +
        (err instanceof Error ? err.message : "Unknown error");
    }

    // Fetch Docker service logs
    let dockerLogs = "Failed to fetch Docker logs";
    try {
      const logsResponse = await fetch("/docker-api/service-logs/");
      if (logsResponse.ok) {
        const logsData = await logsResponse.json();

        // Filter out internal fields and format logs
        const formattedLogs = Object.entries(logsData)
          .filter(([key, _]) => !key.startsWith("_")) // Skip internal fields like _summary
          .map(([service, logs]) => {
            const serviceName = service.replace(/_/g, " ").toUpperCase();
            return `### ${serviceName} LOGS\n\`\`\`\n${logs}\n\`\`\``;
          })
          .join("\n\n");

        // Add summary if available
        const summary = logsData._summary ? `\n\n**${logsData._summary}**` : "";
        dockerLogs = formattedLogs + summary;

        // Check total size and truncate if too large for GitHub
        if (dockerLogs.length > 5000) {
          dockerLogs =
            dockerLogs.substring(0, 5000) +
            "\n\n... (logs truncated due to GitHub URL length limit)";
        }
      }
    } catch (err) {
      console.error("Failed to fetch Docker logs:", err);
      dockerLogs =
        "Error fetching Docker logs: " +
        (err instanceof Error ? err.message : "Unknown error");
    }

    // Fetch tt-inference workflow and docker server/container logs for the active/deployed model (best-effort)
    let ttInferenceLogs = "";
    try {
      const primaryModelName = models[0]?.name;
      const query = primaryModelName
        ? `?model=${encodeURIComponent(primaryModelName)}`
        : "";
      const ttResponse = await fetch(`/logs-api/tt-inference/${query}`);
      if (ttResponse.ok) {
        const ttData = await ttResponse.json();
        const containerBlock = ttData.docker_container_log
          ? `#### vLLM Container Logs (${ttData.docker_container_id || "unknown"})\n\n\`\`\`text\n${ttData.docker_container_log}\n\`\`\``
          : "No matching vLLM container logs found";
        const runLogBlock = ttData.run_log
          ? `#### RUN LOG (${ttData.run_log_file || "latest"})\n\n\`\`\`text\n${ttData.run_log}\n\`\`\``
          : "No matching run logs found";
        const dockerServerLogBlock = ttData.docker_server_log
          ? `#### DOCKER SERVER LOG (${ttData.docker_server_log_file || "latest"})\n\n\`\`\`text\n${ttData.docker_server_log}\n\`\`\``
          : "";
        ttInferenceLogs = [containerBlock, runLogBlock, dockerServerLogBlock]
          .filter(Boolean)
          .join("\n\n");
        if (!ttInferenceLogs) {
          ttInferenceLogs = "No tt-inference logs found for the current model.";
        }
      } else {
        ttInferenceLogs = `Failed to fetch tt-inference logs (status ${ttResponse.status})`;
      }
    } catch (err) {
      console.error("Failed to fetch tt-inference logs:", err);
      ttInferenceLogs =
        "Error fetching tt-inference logs: " +
        (err instanceof Error ? err.message : "Unknown error");
    }

    // Compose full report body first
    const titleRaw = `[Bug Report] Issue in TT Studio ${currentVersion}`;
    const fullBody = `## Bug Report

**TT Studio Version:** ${currentVersion}
**Date:** ${new Date().toLocaleDateString()}
**Time:** ${new Date().toLocaleTimeString()}

### System Information
- **Board:** ${systemStatus.boardName}
- **Hardware Status:** ${systemStatus.hardware_status || "unknown"}
- **CPU Usage:** ${systemStatus.cpuUsage.toFixed(2)}%
- **Memory Usage:** ${systemStatus.memoryUsage.toFixed(1)}% (${systemStatus.memoryTotal})
- **Temperature:** ${systemStatus.temperature.toFixed(1)}°C
- **Devices:** ${systemStatus.devices.length} device(s)
- **Current URL:** ${currentUrl}
- **User Agent:** ${userAgent}

### Hardware Details
${
  systemStatus.devices.length > 0
    ? systemStatus.devices
        .map(
          (device, index) =>
            `**Device ${index + 1}:**
- Board Type: ${device.board_type}
- Temperature: ${device.temperature.toFixed(1)}°C
- Power: ${device.power.toFixed(2)}W
- Voltage: ${device.voltage.toFixed(2)}V`
        )
        .join("\n\n")
    : "No hardware devices detected"
}

### Deployed Models
${models.length > 0 ? models.map((model) => `- ${model.name} (${model.status})`).join("\n") : "No models deployed"}

### Error Information
${error ? `**System Error:** ${error}` : "No system errors detected"}
${systemStatus.hardware_error ? `**Hardware Error:** ${systemStatus.hardware_error}` : "No hardware errors detected"}

### FastAPI Logs
${fastapiLogs}

### Recent Docker Service Logs
${dockerLogs}

### tt-inference Server Logs
${ttInferenceLogs}

**Note**: If the GitHub issue URL is too long, you can copy the logs above and paste them directly into the issue description.

### Bug Description
Please describe the bug you encountered:

### Steps to Reproduce
1. \n2. \n3. \n
### Expected Behavior
What did you expect to happen?

### Actual Behavior
What actually happened?

### Screenshots
Please attach any relevant screenshots here:

### Additional Context
Add any other context about the problem here.

---

*This bug report was automatically generated by TT Studio ${currentVersion}*`;

    // URL building helpers and truncation
    const buildIssueUrl = (title: string, body: string) => {
      const issueTitle = encodeURIComponent(title);
      const issueBody = encodeURIComponent(body);
      return `https://github.com/tenstorrent/tt-studio/issues/new?title=${issueTitle}&body=${issueBody}&labels=bug,auto-generated`;
    };
    const truncate = (text: string, maxChars: number) => {
      if (!text) return text;
      return text.length > maxChars
        ? text.slice(0, maxChars) + "\n\n... (truncated)"
        : text;
    };
    const limitDevicesList = (maxDevices: number) => {
      if (systemStatus.devices.length <= maxDevices) return undefined;
      const blocks = systemStatus.devices
        .map(
          (device, index) =>
            `**Device ${index + 1}:**\n- Board Type: ${device.board_type}\n- Temperature: ${device.temperature.toFixed(1)}°C\n- Power: ${device.power.toFixed(2)}W\n- Voltage: ${device.voltage.toFixed(2)}V`
        )
        .slice(0, maxDevices)
        .join("\n\n");
      return `${blocks}\n\n... (${systemStatus.devices.length - maxDevices} more device entries truncated)`;
    };

    const MAX_URL_LENGTH = 7000; // conservative safety limit for GitHub new-issue URL
    let fullUrl = buildIssueUrl(titleRaw, fullBody);
    if (fullUrl.length > MAX_URL_LENGTH) {
      // Build shortened body
      const truncatedFastapi = truncate(fastapiLogs, 800);
      const truncatedDocker = truncate(dockerLogs, 2500);
      const truncatedTt = truncate(ttInferenceLogs, 2500);
      const devicesLimited = limitDevicesList(2);

      const shortBody = `## Bug Report

**TT Studio Version:** ${currentVersion}
**Date:** ${new Date().toLocaleDateString()}
**Time:** ${new Date().toLocaleTimeString()}

### System Information
- **Board:** ${systemStatus.boardName}
- **Hardware Status:** ${systemStatus.hardware_status || "unknown"}
- **CPU Usage:** ${systemStatus.cpuUsage.toFixed(2)}%
- **Memory Usage:** ${systemStatus.memoryUsage.toFixed(1)}% (${systemStatus.memoryTotal})
- **Temperature:** ${systemStatus.temperature.toFixed(1)}°C
- **Devices:** ${systemStatus.devices.length} device(s)

### Hardware Details (truncated)
${devicesLimited ?? (systemStatus.devices.length ? "(within limit)" : "No hardware devices detected")}

### Deployed Models
${
  models.length > 0
    ? models
        .slice(0, 3)
        .map((m) => `- ${m.name} (${m.status})`)
        .join("\n")
    : "No models deployed"
}

### Error Information
${error ? `**System Error:** ${error}` : "No system errors detected"}
${systemStatus.hardware_error ? `**Hardware Error:** ${systemStatus.hardware_error}` : "No hardware errors detected"}

### FastAPI Logs (truncated)
${truncatedFastapi}

### Recent Docker Service Logs (truncated)
${truncatedDocker}

### tt-inference Server Logs (truncated)
${truncatedTt}

Full logs have been copied to your clipboard and downloaded as a file. Please paste or attach them to this issue.

---

*This bug report was automatically generated by TT Studio ${currentVersion}*`;

      // Copy full body and trigger a download for attachment
      try {
        await navigator.clipboard.writeText(fullBody);
      } catch (clipErr) {
        console.warn("Clipboard copy failed:", clipErr);
      }
      try {
        const blob = new Blob([fullBody], { type: "text/plain;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `tt-studio-bug-report-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (dlErr) {
        console.warn("Download of full report failed:", dlErr);
      }

      return buildIssueUrl(titleRaw, shortBody);
    }

    // Within limit: use full body
    return fullUrl;
  };

  // Function to handle bug report
  const handleReportBug = async () => {
    setBugReportLoading(true);
    try {
      const issueUrl = await generateBugReport();
      window.open(issueUrl, "_blank");
    } catch (err) {
      console.error("Failed to generate bug report:", err);
      // Fallback to basic bug report without logs
      const currentVersion = releaseInfo?.currentVersion || "2.0.1";

      // Fetch FastAPI logs for fallback
      let fallbackFastapiLogs = "Failed to fetch FastAPI logs";
      try {
        const fastapiResponse = await fetch("/logs-api/fastapi/");
        if (fastapiResponse.ok) {
          const fastapiData = await fastapiResponse.json();
          fallbackFastapiLogs =
            fastapiData.fastapi_logs || "No FastAPI logs available";
        }
      } catch (fastapiErr) {
        console.error("Failed to fetch FastAPI logs in fallback:", fastapiErr);
        fallbackFastapiLogs = "Error fetching FastAPI logs";
      }

      const issueTitle = encodeURIComponent(
        `[Bug Report] Issue in TT Studio ${currentVersion}`
      );
      // Best-effort tt-inference logs in fallback as well
      let fallbackTtInferenceLogs = "";
      try {
        const primaryModelName = models[0]?.name;
        const query = primaryModelName
          ? `?model=${encodeURIComponent(primaryModelName)}`
          : "";
        const ttResponse = await fetch(`/logs-api/tt-inference/${query}`);
        if (ttResponse.ok) {
          const ttData = await ttResponse.json();
          const runLogBlock = ttData.run_log
            ? `### RUN LOG (${ttData.run_log_file || "latest"})\n\n\`\`\`\n${ttData.run_log}\n\`\`\``
            : "";
          const dockerServerLogBlock = ttData.docker_server_log
            ? `### DOCKER SERVER LOG (${ttData.docker_server_log_file || "latest"})\n\n\`\`\`\n${ttData.docker_server_log}\n\`\`\``
            : "";
          fallbackTtInferenceLogs = [runLogBlock, dockerServerLogBlock]
            .filter(Boolean)
            .join("\n\n");
        }
      } catch (error) {
        // Ignore errors when fetching TT inference logs
        console.debug("Failed to fetch TT inference logs:", error);
      }

      const issueBody = encodeURIComponent(`## Bug Report

**TT Studio Version:** ${currentVersion}
**Date:** ${new Date().toLocaleDateString()}
**Time:** ${new Date().toLocaleTimeString()}

### System Information
- **Board:** ${systemStatus.boardName}
- **Hardware Status:** ${systemStatus.hardware_status || "unknown"}
- **CPU Usage:** ${systemStatus.cpuUsage.toFixed(2)}%
- **Memory Usage:** ${systemStatus.memoryUsage.toFixed(1)}% (${systemStatus.memoryTotal})
- **Temperature:** ${systemStatus.temperature.toFixed(1)}°C
- **Devices:** ${systemStatus.devices.length} device(s)

### Error Information
${error ? `**System Error:** ${error}` : "No system errors detected"}
${systemStatus.hardware_error ? `**Hardware Error:** ${systemStatus.hardware_error}` : "No hardware errors detected"}

### FastAPI Logs
${fallbackFastapiLogs}

### tt-inference Server Logs
${fallbackTtInferenceLogs || "Unavailable in fallback"}

### Bug Description
Please describe the bug you encountered:

### Steps to Reproduce
1. 
2. 
3. 

### Expected Behavior
What did you expect to happen?

### Actual Behavior
What actually happened?

### Additional Context
Add any other context about the problem here.

---

*This bug report was automatically generated by TT Studio ${currentVersion}*`);

      const fallbackUrl = `https://github.com/tenstorrent/tt-studio/issues/new?title=${issueTitle}&body=${issueBody}&labels=bug,auto-generated`;
      window.open(fallbackUrl, "_blank");
    } finally {
      setBugReportLoading(false);
    }
  };

  // Show loading state
  if (loading) {
    return shouldHideFooter ? null : (
      <motion.footer
        className={`fixed bottom-0 left-0 right-0 z-40 ${bgColor} backdrop-blur-sm border-t ${borderColor} ${className}`}
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center space-x-4">
            <span className={`text-sm ${textColor}`}>
              TT Studio {releaseInfo?.currentVersion || "0.3.11"}
            </span>
            <Badge variant="default" className="text-xs">
              Loading...
            </Badge>
          </div>
          <div className="flex items-center space-x-6">
            <span className={`text-sm ${mutedTextColor}`}>
              LOADING SYSTEM RESOURCES...
            </span>
          </div>
        </div>
      </motion.footer>
    );
  }

  return shouldHideFooter ? null : (
    <>
      <motion.footer
        className={`fixed bottom-0 left-0 right-0 z-40 ${bgColor} backdrop-blur-sm border-t ${borderColor} ${className}`}
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left Section - App Info & Board */}
          <div className="flex items-center space-x-4">
            <div
              className={`flex items-center gap-1.5 text-sm ${textColor} cursor-pointer hover:text-TT-purple-accent transition-colors duration-200`}
              onClick={() => setShowTTStudioModal(true)}
              title="Click to view TT Studio information"
            >
              <span>TT Studio 2.0.1</span>
              <Github className="h-3.5 w-3.5" />
            </div>
            {systemStatus.boardName?.toLowerCase().includes("t3k") ? (
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-TT-purple-accent/10 dark:bg-TT-purple-accent/30 rounded-full cursor-pointer transition-all duration-200 hover:bg-TT-purple-accent/20 dark:hover:bg-TT-purple-accent/40 hover:scale-105"
                title="Hardware status - Click to learn more"
                onClick={() => {
                  window.open(
                    "https://tenstorrent.com/hardware/tt-quietbox",
                    "_blank"
                  );
                }}
              >
                <HardwareIcon type="loudbox" className="h-4 w-4" />
                <span className="text-sm font-medium text-TT-purple-accent">
                  {systemStatus.boardName}
                </span>
              </div>
            ) : systemStatus.boardName?.toLowerCase().includes("n300") ? (
              <div
                className="flex items-center gap-2 px-3 py-1.5 bg-TT-purple-accent/10 dark:bg-TT-purple-accent/30 rounded-full cursor-pointer transition-all duration-200 hover:bg-TT-purple-accent/20 dark:hover:bg-TT-purple-accent/40 hover:scale-105"
                title="Hardware status - Click to learn more"
                onClick={() => {
                  window.open(
                    "https://tenstorrent.com/hardware/wormhole",
                    "_blank"
                  );
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 600 580.599"
                  className="text-TT-purple-accent"
                >
                  <path
                    fill="currentColor"
                    d="M149.98 0 0 112.554v75.035l57.16 42.904-12.692 9.525v63.924l52.944 39.728-17.704 13.291v55.101l50.146 37.646-17.786 13.371v47l93.945 70.52h187.934l93.945-70.52v-47l-17.787-13.371 50.147-37.646v-55.101L502.55 343.67l52.939-39.728v-63.924l-12.69-9.525 57.16-42.904v-75.035h.042L449.98 0ZM49.979 150.069l100-75.035h300l100 75.035-100 75.034h.042H149.98Zm400 150.114 50.23-37.726 12.69 9.526h.046l-85.178 63.918H172.234l-85.177-63.918 12.693-9.526 50.23 37.726Zm-22.212 99.601 38.12-28.577 17.703 13.285-73.443 55.107H189.854l-73.444-55.107 17.703-13.285 38.12 28.577Zm-17.58 94.922 28.686-21.518 17.787 13.371h-.041l-62.631 47H206.055l-62.631-47 17.787-13.371 28.685 21.518Z"
                  />
                </svg>
                <span className="text-sm font-medium text-TT-purple-accent">
                  {systemStatus.boardName}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={
                    systemStatus.hardware_status === "error"
                      ? "destructive"
                      : error
                        ? "destructive"
                        : "default"
                  }
                  className={`text-xs ${textColor} cursor-pointer transition-all duration-200 hover:scale-105 hover:bg-opacity-80`}
                  title={
                    systemStatus.hardware_error ||
                    error ||
                    "Hardware status - Click to learn more"
                  }
                  onClick={() => {
                    window.open("https://www.tenstorrent.com/hardware", "_blank");
                  }}
                >
                  {systemStatus.boardName}
                  {systemStatus.hardware_status === "error" && " ⚠️"}
                </Badge>
                {isBoardDetectionIssue && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={handleRefreshBoardDetection}
                          disabled={refreshing || isInCooldown}
                          className={`p-1 rounded-full border border-transparent transition-colors duration-150 ${
                            refreshing
                              ? "opacity-70 cursor-wait"
                              : isInCooldown
                                ? "opacity-60 cursor-not-allowed"
                                : "hover:bg-TT-purple-accent/10 dark:hover:bg-TT-purple-accent/20"
                          }`}
                          aria-label="Retry board detection"
                        >
                          <RefreshCw
                            className={`h-4 w-4 text-TT-purple-accent ${
                              refreshing ? "animate-spin" : ""
                            }`}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {isInCooldown
                            ? `Please wait ${cooldownSeconds}s before refreshing again`
                            : "Click to retry board detection"}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
            {(error || systemStatus.hardware_error) && (
              <span
                className={`text-xs text-red-500`}
                title={systemStatus.hardware_error || error || "System error"}
              >
                ⚠️
              </span>
            )}

            {/* Deployed Models Section */}
            <div className="flex items-center gap-2">
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

              {/* Logs Button */}
              {models.length > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLogsClick}
                        className="h-6 px-2 text-xs bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 dark:hover:bg-blue-900"
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        Logs
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Open logs for {models[0].name || "deployed model"}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>

          {/* Right Section - System Resources & Controls */}
          <div className="flex items-center space-x-6">
            <span className={`text-sm ${mutedTextColor}`}>
              SYSTEM RESOURCES USAGE:
            </span>
            <span className={`text-sm ${textColor}`}>
              RAM: {systemStatus.memoryUsage.toFixed(1)}% (
              {systemStatus.memoryTotal}) | CPU:{" "}
              {systemStatus.cpuUsage.toFixed(2)}%
              {systemStatus.hardware_status === "healthy" && (
                <> | TEMP: {systemStatus.temperature.toFixed(1)}°C</>
              )}
              {systemStatus.hardware_status === "error" && (
                <> | TT HARDWARE: UNAVAILABLE</>
              )}
              {systemStatus.hardware_status === "unknown" && (
                <> | TT HARDWARE: CHECKING...</>
              )}
            </span>
            {systemStatus.devices.length > 1 &&
              systemStatus.hardware_status === "healthy" && (
                <span className={`text-xs ${mutedTextColor}`}>
                  ({systemStatus.devices.length} devices)
                </span>
              )}
          </div>
        </div>
      </motion.footer>

      {/* TT Studio Information Modal */}
      <Dialog open={showTTStudioModal} onOpenChange={setShowTTStudioModal}>
        <DialogContent className="sm:max-w-2xl bg-white dark:bg-TT-black border border-TT-purple-accent/20 dark:border-TT-purple-accent/30">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-xl font-bold text-gray-900 dark:text-white">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-TT-purple-accent" />
                TT Studio Information
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={refetch}
                disabled={releasesLoading}
                className="h-8 w-8 p-0"
                title="Refresh release information"
              >
                <RefreshCw
                  className={`h-4 w-4 ${releasesLoading ? "animate-spin" : ""}`}
                />
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Version Info */}
            <div className="bg-TT-purple-accent/5 dark:bg-TT-purple-accent/10 border border-TT-purple-accent/20 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    TT Studio {releaseInfo?.currentVersion || "2.0.1"}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    {releasesLoading
                      ? "Loading release information..."
                      : releaseInfo?.latest?.body?.split("\n")[0] ||
                        "Latest patch release with bug fixes and UI/UX improvements"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {releasesLoading && (
                    <RefreshCw className="h-4 w-4 animate-spin text-TT-purple-accent" />
                  )}
                  <Badge
                    variant={releaseInfo?.isLatest ? "default" : "outline"}
                    className={
                      releaseInfo?.isLatest
                        ? "bg-TT-purple-accent text-white"
                        : "bg-orange-500 text-white"
                    }
                  >
                    {releaseInfo?.isLatest
                      ? "Latest Version"
                      : "Update Available"}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Links Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Button
                variant="outline"
                className="flex items-center gap-2 h-auto p-4 border-TT-purple-accent/30 hover:border-TT-purple-accent hover:bg-TT-purple-accent/5 dark:hover:bg-TT-purple-accent/10"
                onClick={() =>
                  window.open(
                    "https://github.com/tenstorrent/tt-studio",
                    "_blank"
                  )
                }
              >
                <Github className="h-5 w-5 text-TT-purple-accent" />
                <div className="text-left">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    GitHub Repository
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    View source code and docs
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-TT-purple-accent ml-auto" />
              </Button>

              <Button
                variant="outline"
                className="flex items-center gap-2 h-auto p-4 border-TT-purple-accent/30 hover:border-TT-purple-accent hover:bg-TT-purple-accent/5 dark:hover:bg-TT-purple-accent/10"
                onClick={() =>
                  window.open(
                    "https://github.com/tenstorrent/tt-studio/releases",
                    "_blank"
                  )
                }
              >
                <Package className="h-5 w-5 text-TT-purple-accent" />
                <div className="text-left">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    Release Notes
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    View latest updates and fixes
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-TT-purple-accent ml-auto" />
              </Button>
            </div>

            {/* Latest Release Notes */}
            <div className="bg-TT-purple-accent/5 dark:bg-TT-purple-accent/10 border border-TT-purple-accent/30 rounded-lg p-4">
              <h4 className="font-semibold text-TT-purple-accent mb-3 flex items-center gap-2">
                <Package className="h-4 w-4" />
                {releasesLoading
                  ? "Loading release information..."
                  : `Latest Release: ${releaseInfo?.latest?.tag_name || "v2.0.1"} (${formattedDate || "July 21, 2025"})`}
              </h4>
              {releasesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <RefreshCw className="h-6 w-6 animate-spin text-TT-purple-accent" />
                  <span className="ml-2 text-sm text-gray-600 dark:text-gray-300">
                    Loading release notes...
                  </span>
                </div>
              ) : releasesError ? (
                <div className="text-sm text-red-600 dark:text-red-400">
                  Failed to load release notes. Using cached information.
                </div>
              ) : (
                <div className="text-sm text-gray-800 dark:text-gray-200 space-y-3">
                  {parsedNotes?.bugFixes && parsedNotes.bugFixes.length > 0 && (
                    <div>
                      <h5 className="font-medium mb-2 text-TT-purple-accent">
                        🐛 Bug Fixes & Improvements
                      </h5>
                      <ul className="space-y-1 ml-4">
                        {parsedNotes.bugFixes.map((fix, index) => (
                          <li key={index}>• {fix}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {parsedNotes?.features && parsedNotes.features.length > 0 && (
                    <div>
                      <h5 className="font-medium mb-2 text-TT-purple-accent">
                        ✨ New Features
                      </h5>
                      <ul className="space-y-1 ml-4">
                        {parsedNotes.features.map((feature, index) => (
                          <li key={index}>• {feature}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {parsedNotes?.community &&
                    parsedNotes.community.length > 0 && (
                      <div>
                        <h5 className="font-medium mb-2 text-TT-purple-accent">
                          👥 Community Contributions
                        </h5>
                        <ul className="space-y-1 ml-4">
                          {parsedNotes.community.map((contribution, index) => (
                            <li key={index}>• {contribution}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  {(!parsedNotes ||
                    (parsedNotes.bugFixes.length === 0 &&
                      parsedNotes.features.length === 0 &&
                      parsedNotes.community.length === 0)) && (
                    <div>
                      <h5 className="font-medium mb-2 text-TT-purple-accent">
                        🐛 Bug Fixes & Improvements
                      </h5>
                      <ul className="space-y-1 ml-4">
                        <li>
                          • <strong>UI Enhancement:</strong> Removed unnecessary
                          close button (x) that was causing confusion
                        </li>
                        <li>
                          • <strong>Accessibility Fix:</strong> Resolved
                          unreadable error label text in light mode
                        </li>
                        <li>
                          • <strong>Theme Enhancement:</strong> Comprehensive
                          light/dark mode improvements across the entire
                          application
                        </li>
                        <li>
                          • <strong>User Experience:</strong> Better visual
                          consistency and readability throughout the interface
                        </li>
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Previous Major Release */}
            <div className="bg-TT-purple-accent/5 dark:bg-TT-purple-accent/10 border border-TT-purple-accent/20 rounded-lg p-4">
              <h4 className="font-semibold text-TT-purple-accent mb-2 flex items-center gap-2">
                <Info className="h-4 w-4" />
                Major Release: v2.0.0 (July 18, 2025)
              </h4>
              <ul className="text-sm text-gray-800 dark:text-gray-200 space-y-1">
                <li>
                  • 🚀 <strong>AI Playground Launch:</strong> Connect to
                  external TT hardware model endpoints
                </li>
                <li>
                  • 🎙️ <strong>New AI Models:</strong> Whisper for
                  speech-to-text and enhanced Stable Diffusion
                </li>
                <li>
                  • ✨ <strong>UI/UX Overhaul:</strong> Comprehensive redesign
                  for mobile and desktop
                </li>
                <li>
                  • ⚙️ <strong>New Infrastructure:</strong> Updated run.py
                  script and tt-inference-server integration
                </li>
                <li>
                  • 🧠 <strong>Enhanced RAG and Chat:</strong> Multi-modal file
                  uploads and granular controls
                </li>
                <li>
                  • 👁️ <strong>Object Detection Fixes:</strong> Improved YOLOv4
                  interface and webcam controls
                </li>
              </ul>
            </div>

            {/* Footer Actions */}
            <div className="flex justify-end gap-2 pt-4 border-t border-TT-purple-accent/20">
              <Button
                variant="outline"
                onClick={() => setShowTTStudioModal(false)}
                className="border-TT-purple-accent/30 hover:border-TT-purple-accent hover:bg-TT-purple-accent/5 dark:hover:bg-TT-purple-accent/10"
              >
                Close
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={handleReportBug}
                      disabled={bugReportLoading}
                      className="border-red-200 hover:border-red-300 hover:bg-red-50 dark:border-red-800 dark:hover:border-red-700 dark:hover:bg-red-950/50 text-red-600 dark:text-red-400"
                    >
                      {bugReportLoading ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Bug className="h-4 w-4 mr-2" />
                      )}
                      {bugReportLoading ? "Generating..." : "Report Bug"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      Generate a comprehensive bug report with system
                      information, hardware details, and recent Docker service
                      logs
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                onClick={() => {
                  window.open(
                    "https://github.com/tenstorrent/tt-studio",
                    "_blank"
                  );
                  setShowTTStudioModal(false);
                }}
                className="bg-TT-purple-accent hover:bg-TT-purple-accent/90 text-white"
              >
                {/* <Github className="h-4 w-4 mr-2" /> */}
                <ExternalLink className="h-4 w-4 text-TT-purple-accent ml-auto" />
                Visit GitHub
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Footer;
