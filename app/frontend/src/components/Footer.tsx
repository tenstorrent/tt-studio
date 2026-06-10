// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "./ui/badge";
import { useTheme } from "../hooks/useTheme";
import { useNavigate, useLocation } from "react-router-dom";
import { useModels } from "../hooks/useModels";
import { useDeviceState } from "../hooks/useDeviceState";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { getBuildInfo } from "../api/githubApi";
import { HardwareIcon } from "./aiPlaygroundHome/HardwareIcon";
import { cn } from "../lib/utils";
import { useFooterVisibility } from "../hooks/useFooterVisibility";

interface FooterProps {
  className?: string;
}

interface SystemResources {
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: string;
}

const REFRESH_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes cooldown between manual refreshes

const FOOTER_HEIGHT_CSS_VAR = "--footer-height";

const Footer: React.FC<FooterProps> = ({ className }) => {
  const { showFooter, setShowFooter } = useFooterVisibility();
  const { theme } = useTheme();
  const footerRef = useRef<HTMLElement>(null);
  const [systemResources, setSystemResources] = useState<SystemResources>({
    cpuUsage: 0,
    memoryUsage: 0,
    memoryTotal: "0 GB",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshTime = useRef<number | null>(null);
  const [showModelPopover, setShowModelPopover] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ left: number; top: number } | null>(null);
  const popoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeWrapperRef = useRef<HTMLDivElement>(null);
  const { models } = useModels();
  const { deviceState, refresh: refreshDeviceState } = useDeviceState();
  const navigate = useNavigate();
  const location = useLocation();

  // Version shown in the footer reflects the build the user is running (injected
  // from git at build time): the release tag for official builds, the branch name
  // otherwise. Falls back to just "TT Studio" when neither is available.
  const buildInfo = getBuildInfo();
  const versionLabel = buildInfo.isOfficialRelease
    ? buildInfo.label
    : buildInfo.branch
      ? `· ${buildInfo.branch}`
      : "";
  const appVersionText = `TT Studio${versionLabel ? ` ${versionLabel}` : ""}`;

  // Fetch only CPU/memory resources (board info comes from DeviceStateContext)
  const fetchSystemResources = async () => {
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
      setSystemResources({
        cpuUsage: data.cpuUsage ?? 0,
        memoryUsage: data.memoryUsage ?? 0,
        memoryTotal: data.memoryTotal ?? "0 GB",
      });
      setError(null);
    } catch (err) {
      console.error("Failed to fetch system resources:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
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
      // Trigger an immediate re-poll of device state via context
      refreshDeviceState();
    } catch (err) {
      console.error("Failed to refresh board detection:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      lastRefreshTime.current = Date.now();
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // Fetch CPU/memory once on mount (board info is handled by DeviceStateContext)
    fetchSystemResources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-hide footer when navigating to Chat UI
  useEffect(() => {
    if (location.pathname === "/chat") {
      setShowFooter(false);
    }
  }, [location.pathname, setShowFooter]);

  // Update --footer-height CSS variable on document root whenever footer visibility or content changes
  useEffect(() => {
    const updateFooterHeight = () => {
      if (showFooter && footerRef.current) {
        const height = footerRef.current.offsetHeight;
        document.documentElement.style.setProperty(
          FOOTER_HEIGHT_CSS_VAR,
          `${height}px`
        );
      } else {
        document.documentElement.style.setProperty(
          FOOTER_HEIGHT_CSS_VAR,
          "0px"
        );
      }
    };

    updateFooterHeight();
    // Re-measure after animation completes (spring animation ~300ms)
    const timer = setTimeout(updateFooterHeight, 350);
    return () => clearTimeout(timer);
  }, [showFooter, loading]);

  const textColor = theme === "dark" ? "text-zinc-300" : "text-gray-700";
  const borderColor = theme === "dark" ? "border-zinc-700" : "border-gray-200";
  const bgColor = theme === "dark" ? "bg-zinc-900/95" : "bg-white/95";
  const mutedTextColor = theme === "dark" ? "text-zinc-400" : "text-gray-500";

  // On pages with a vertical sidebar (chat, image-generation), offset footer so it
  // starts after the 64px (w-16) sidebar instead of overlapping it.
  const hasVerticalNav =
    location.pathname === "/chat" ||
    location.pathname === "/image-generation" ||
    location.pathname === "/video-generation";
  const footerLeft = hasVerticalNav ? "left-16" : "left-0";

  // Derive board info from DeviceStateContext
  const boardName = deviceState?.board_name ?? "Unknown";
  const deviceStateName = deviceState?.state ?? "UNKNOWN";
  const devices = deviceState?.devices ?? [];
  const avgTemperature =
    devices.length > 0
      ? Math.round(
        (devices.reduce((sum, d) => sum + (d.temperature ?? 0), 0) /
          devices.length) *
        10
      ) / 10
      : 0;
  const isHardwareError =
    deviceStateName === "BAD_STATE" || deviceStateName === "NOT_PRESENT";
  const normalizedBoardName = boardName.toLowerCase();
  const isBoardDetectionIssue =
    isHardwareError ||
    !!error ||
    normalizedBoardName === "error" ||
    normalizedBoardName === "unknown" ||
    normalizedBoardName === "not present" ||
    normalizedBoardName === "bad state";
  const remainingCooldownMs = getRemainingCooldownMs();
  const isInCooldown = remainingCooldownMs > 0;
  const cooldownSeconds = Math.ceil(remainingCooldownMs / 1000);

  // Legacy-compatible derived values used by bug-report and render
  const hardwareStatus: "healthy" | "error" | "unknown" =
    deviceStateName === "HEALTHY"
      ? "healthy"
      : deviceStateName === "BAD_STATE" || deviceStateName === "NOT_PRESENT"
        ? "error"
        : "unknown";
  const hardwareError =
    deviceStateName === "BAD_STATE"
      ? "Board is in a bad state (unresponsive). Reset recommended."
      : deviceStateName === "NOT_PRESENT"
        ? "No Tenstorrent device detected. Check hardware connection."
        : null;

  // Hover popover handlers for deployed models
  const handlePopoverEnter = () => {
    if (popoverTimeoutRef.current) clearTimeout(popoverTimeoutRef.current);
    if (models.length > 0) {
      const rect = badgeWrapperRef.current?.getBoundingClientRect();
      if (rect) {
        setPopoverPos({ left: rect.left, top: rect.top });
      }
      setShowModelPopover(true);
    }
  };

  const handlePopoverLeave = () => {
    popoverTimeoutRef.current = setTimeout(() => setShowModelPopover(false), 200);
  };

  const getHealthColor = (health: unknown, status?: unknown) => {
    const h = String(health ?? "").toLowerCase();
    const s = String(status ?? "").toLowerCase();
    if (h === "unhealthy" || s.includes("exited")) return "bg-TT-red-accent";
    if (h === "healthy" || s.includes("running") || s === "deployed") return "bg-TT-green";
    if (h === "starting") return "bg-TT-yellow";
    return "bg-TT-yellow";
  };

  const getStatusText = (status: unknown) => {
    const s = String(status ?? "").toLowerCase();
    if (s.includes("running")) return "Running";
    if (s.includes("exited")) return "Stopped";
    return String(status) || "Unknown";
  };

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


  return (
    <>
      <AnimatePresence mode="wait">
        {!showFooter ? (
          <motion.div
            key="toggle-button"
            className="fixed -bottom-1 z-40 -translate-x-1/2"
            style={{ left: hasVerticalNav ? "calc(50% + 2rem)" : "50%" }}
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowFooter(true)}
                    className="hover:scale-110 transition-transform duration-200"
                    aria-label="Show footer"
                  >
                    <ChevronUp
                      className="w-7 h-7"
                      strokeWidth={3}
                      style={{ color: theme === "dark" ? "#e4e4e7" : "#18181b" }}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Show footer</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </motion.div>
        ) : loading ? (
          <motion.footer
            key="footer-loading"
            ref={footerRef}
            className={`fixed bottom-0 ${footerLeft} right-0 z-40 ${bgColor} backdrop-blur-sm border-t ${borderColor} ${className}`}
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-10">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setShowFooter(false)}
                      className="hover:scale-110 transition-transform duration-200"
                      aria-label="Hide footer"
                    >
                      <ChevronDown
                        className="w-7 h-7"
                        strokeWidth={3}
                        style={{ color: theme === "dark" ? "#e4e4e7" : "#18181b" }}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Hide footer</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center space-x-4">
                <span className={`text-sm ${textColor}`}>
                  {appVersionText}
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
        ) : (
          <motion.footer
            key="footer-content"
            ref={footerRef}
            className={`fixed bottom-0 ${footerLeft} right-0 z-40 ${bgColor} backdrop-blur-sm border-t ${borderColor} ${className}`}
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            {/* Toggle button - absolutely positioned at bottom center */}
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-10">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setShowFooter(false)}
                      className="hover:scale-110 transition-transform duration-200"
                      aria-label="Hide footer"
                    >
                      <ChevronDown
                        className="w-7 h-7"
                        strokeWidth={3}
                        style={{
                          color: theme === "dark" ? "#e4e4e7" : "#18181b",
                        }}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Hide footer</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              {/* Left Section - App Info & Board */}
              <div className="flex items-center space-x-4">
                <a
                  href="https://github.com/tenstorrent/tt-studio"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-1.5 text-sm ${textColor} hover:text-TT-purple-accent transition-colors duration-200`}
                  title="Open TT Studio on GitHub"
                  aria-label="Open TT Studio on GitHub"
                >
                  <span>{appVersionText}</span>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 96 96"
                    xmlns="http://www.w3.org/2000/svg"
                    className="flex-shrink-0"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
                      fill={theme === "dark" ? "#fff" : "#24292f"}
                    />
                  </svg>
                </a>
                {boardName?.toLowerCase().includes("t3k") ? (
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
                      {boardName}
                    </span>
                  </div>
                ) : boardName?.toLowerCase().includes("n300") ? (
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
                      {boardName}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant={
                        hardwareStatus === "error"
                          ? "destructive"
                          : error
                            ? "destructive"
                            : "default"
                      }
                      className={`text-xs ${textColor} cursor-pointer transition-all duration-200 hover:scale-105 hover:bg-opacity-80`}
                      title={
                        hardwareError ||
                        error ||
                        "Hardware status - Click to learn more"
                      }
                      onClick={() => {
                        window.open(
                          "https://www.tenstorrent.com/hardware",
                          "_blank"
                        );
                      }}
                    >
                      {boardName}
                      {hardwareStatus === "error" && " ⚠️"}
                    </Badge>
                    {isBoardDetectionIssue && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={handleRefreshBoardDetection}
                              disabled={refreshing || isInCooldown}
                              className={`p-1 rounded-full border border-transparent transition-colors duration-150 ${refreshing
                                  ? "opacity-70 cursor-wait"
                                  : isInCooldown
                                    ? "opacity-60 cursor-not-allowed"
                                    : "hover:bg-TT-purple-accent/10 dark:hover:bg-TT-purple-accent/20"
                                }`}
                              aria-label="Retry board detection"
                            >
                              <RefreshCw
                                className={`h-4 w-4 text-TT-purple-accent ${refreshing ? "animate-spin" : ""
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
                {(error || hardwareError) && (
                  <span
                    className={`text-xs text-red-500`}
                    title={hardwareError || error || "System error"}
                  >
                    ⚠️
                  </span>
                )}

                {/* Deployed Models Section */}
                <div className="flex items-center gap-2">
                  <div
                    ref={badgeWrapperRef}
                    className="inline-block"
                    onMouseEnter={handlePopoverEnter}
                    onMouseLeave={handlePopoverLeave}
                  >
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs cursor-pointer transition-all duration-300",
                        models.length > 0
                          ? "bg-TT-purple-accent/20 text-TT-purple-tint1 border-TT-purple-accent/30 hover:bg-TT-purple-accent/30 hover:shadow-[0_0_12px_rgba(124,104,250,0.3)] hover:scale-105"
                          : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                      )}
                      onClick={() => {
                        setShowModelPopover(false);
                        handleDeployedModelsClick();
                      }}
                    >
                      📟 {getDeployedModelsText()}
                    </Badge>
                  </div>

                  {/* Hover popover - rendered via portal to escape footer overflow */}
                  {models.length > 0 && showModelPopover && popoverPos && createPortal(
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="fixed w-80 z-[9999] rounded-xl border border-TT-purple-accent/20 bg-stone-950 shadow-[0_0_30px_rgba(124,104,250,0.15)]"
                      style={{ left: popoverPos.left, top: popoverPos.top - 8 }}
                      onMouseEnter={handlePopoverEnter}
                      onMouseLeave={handlePopoverLeave}
                    >
                      <div style={{ transform: 'translateY(-100%)' }} className="bg-stone-950 rounded-xl border border-TT-purple-accent/20 overflow-hidden">
                        {/* Header */}
                        <div className="px-4 pt-3 pb-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-TT-purple-tint1 uppercase tracking-wider">
                              Deployed Models
                            </span>
                            <span className="text-[10px] text-TT-purple/60 font-mono">
                              {models.length} active
                            </span>
                          </div>
                          <div className="mt-2 h-[1px] w-full bg-gradient-to-r from-transparent via-TT-purple-accent/50 to-transparent" />
                        </div>

                        {/* Model list */}
                        <div className="px-2 py-2 max-h-48 overflow-y-auto">
                          {models.map((model, index) => (
                            <motion.div
                              key={model.id}
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: index * 0.05, duration: 0.2 }}
                              className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors group"
                            >
                              {/* Health dot */}
                              <div className="relative flex-shrink-0">
                                <div className={cn(
                                  "w-2 h-2 rounded-full",
                                  getHealthColor(model.health, model.status)
                                )} />
                                {getHealthColor(model.health, model.status) === "bg-TT-green" && (
                                  <div className={cn(
                                    "absolute inset-0 w-2 h-2 rounded-full animate-ping opacity-30",
                                    getHealthColor(model.health, model.status)
                                  )} />
                                )}
                              </div>

                              {/* Model info */}
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-stone-100 truncate">
                                  {model.name || "Unknown Model"}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {model.model_type && (
                                    <span className="text-[10px] text-TT-purple/80 font-mono">
                                      {model.model_type}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-stone-500">
                                    {getStatusText(model.status)}
                                  </span>
                                </div>
                              </div>

                              {/* Device ID badge */}
                              {model.device_id != null && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-TT-purple-accent/10 text-TT-purple/70 font-mono flex-shrink-0">
                                  dev:{model.device_id}
                                </span>
                              )}
                            </motion.div>
                          ))}
                        </div>

                        {/* Footer hint */}
                        <div
                          className="px-4 py-2 border-t border-white/10 cursor-pointer hover:bg-white/5 transition-colors"
                          onClick={() => {
                            setShowModelPopover(false);
                            handleDeployedModelsClick();
                          }}
                        >
                          <span className="text-[10px] text-stone-500">
                            Click to manage models →
                          </span>
                        </div>
                      </div>
                    </motion.div>,
                    document.body
                  )}

                </div>
              </div>

              {/* Right Section - System Resources & Controls */}
              <div className="flex items-center space-x-6">
                <span className={`text-sm ${mutedTextColor}`}>
                  SYSTEM RESOURCES USAGE:
                </span>
                <span className={`text-sm ${textColor}`}>
                  RAM: {systemResources.memoryUsage.toFixed(1)}% (
                  {systemResources.memoryTotal}) | CPU:{" "}
                  {systemResources.cpuUsage.toFixed(2)}%
                  {hardwareStatus === "healthy" && (
                    <> | TEMP: {avgTemperature.toFixed(1)}°C</>
                  )}
                  {hardwareStatus === "error" && (
                    <> | TT HARDWARE: UNAVAILABLE</>
                  )}
                  {hardwareStatus === "unknown" && (
                    <> | TT HARDWARE: CHECKING...</>
                  )}
                </span>
                {devices.length > 1 &&
                  hardwareStatus === "healthy" && (
                    <span className={`text-xs ${mutedTextColor}`}>
                      ({devices.length} devices)
                    </span>
                  )}
              </div>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>
    </>
  );
};

export default Footer;
