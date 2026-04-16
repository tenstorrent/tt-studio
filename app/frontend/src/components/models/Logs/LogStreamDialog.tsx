// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useRef, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs";
import { Spinner } from "../../ui/spinner";
import { Button } from "../../ui/button";
import { useLogStream } from "../../../hooks/useLogStream";
import { Switch } from "../../ui/switch";
import LogView from "./LogView";
import EventsView from "./EventsView";
import MetricsView from "./MetricsView";

interface Props {
  open: boolean;
  containerId: string;
  modelName?: string;
  onClose: () => void;
}

export default function LogStreamDialog({
  open,
  containerId,
  modelName,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState("logs");
  const [reloadKey, setReloadKey] = useState(0);

  const {
    logs,
    events,
    metrics,
    error,
    isLoading,
    filters,
    setFilters,
    filterLog,
  } = useLogStream(open, containerId, reloadKey);

  const shortName = useMemo(
    () => (modelName ? modelName.split("/").slice(-1)[0] : undefined),
    [modelName]
  );
  const isHFModel = useMemo(
    () => !!modelName && /.+\/.+/.test(modelName),
    [modelName]
  );

  const logsRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);

  const getCurrentRef = () => {
    if (activeTab === "logs") return logsRef;
    if (activeTab === "events") return eventsRef;
    if (activeTab === "metrics") return metricsRef;
    return logsRef;
  };

  useEffect(() => {
    const currentRef = getCurrentRef();
    if (autoScrollEnabled && currentRef.current) {
      currentRef.current.scrollTop = currentRef.current.scrollHeight;
    }
  }, [logs, events, metrics, autoScrollEnabled, activeTab]);

  const handleScroll = () => {
    const ref = getCurrentRef();
    if (ref.current) {
      const isAtBottom =
        ref.current.scrollHeight -
          ref.current.scrollTop -
          ref.current.clientHeight <
        10;
      setAutoScrollEnabled(isAtBottom);
      setShowScrollButton(!isAtBottom);
    }
  };

  const scrollToBottom = () => {
    const ref = getCurrentRef();
    if (ref.current) {
      ref.current.scrollTo({
        top: ref.current.scrollHeight,
        behavior: "smooth",
      });
      setAutoScrollEnabled(true);
      setShowScrollButton(false);
    }
  };

  const HuggingFaceBadge = () => (
    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-400 text-black text-[11px] leading-none mr-1">
      🤗
    </span>
  );

  const renderLoading = () => {
    const colorClass =
      activeTab === "logs"
        ? "text-green-400"
        : activeTab === "events"
          ? "text-blue-400"
          : "text-yellow-400";
    const message =
      activeTab === "logs"
        ? "Connecting to log stream..."
        : activeTab === "events"
          ? "Connecting to event stream..."
          : "Connecting to metrics stream...";
    return (
      <div
        className={`bg-gray-950 ${colorClass} p-4 rounded-lg font-mono text-sm border border-gray-700 shadow-inner flex items-center justify-center h-32`}
      >
        <div className="flex flex-col items-center gap-2">
          <Spinner className="w-8 h-8" />
          <span className="text-sm">{message}</span>
        </div>
      </div>
    );
  };

  const renderError = () => (
    <div className="flex flex-col gap-4">
      <div className="bg-red-950/40 border border-red-800 rounded-lg p-4 text-sm font-mono">
        <div className="flex items-start gap-2">
          <span className="text-red-400 font-bold shrink-0">Error</span>
          <span className="text-red-300">{error}</span>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => setReloadKey((k) => k + 1)}
          className="bg-green-700 hover:bg-green-600 text-white w-32"
        >
          Retry
        </Button>
        <Button
          onClick={onClose}
          className="bg-gray-700 hover:bg-gray-600 text-white w-32"
        >
          Close
        </Button>
      </div>
    </div>
  );

  const renderContent = () => {
    if (isLoading) return renderLoading();
    if (error) return renderError();

    switch (activeTab) {
      case "logs":
        return (
          <LogView
            logs={logs}
            filterLog={filterLog}
            onScroll={handleScroll}
            scrollRef={logsRef}
            showScrollButton={showScrollButton}
            scrollToBottom={scrollToBottom}
          />
        );
      case "events":
        return (
          <EventsView
            events={events}
            filterLog={filterLog}
            onScroll={handleScroll}
            scrollRef={eventsRef}
            showScrollButton={showScrollButton}
            scrollToBottom={scrollToBottom}
          />
        );
      case "metrics":
        return (
          <MetricsView
            metrics={metrics}
            onScroll={handleScroll}
            scrollRef={metricsRef}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-6xl max-h-[95vh] min-w-[600px] min-h-[400px] resize flex flex-col"
        style={{ resize: "both" }}
      >
        <DialogHeader className="shrink-0 pb-4 border-b border-gray-200 dark:border-gray-700">
          <DialogTitle className="flex items-center gap-2">
            <span className="flex items-center gap-2">
              {isHFModel && <HuggingFaceBadge />}
              <span>Container Monitoring - {shortName || containerId}</span>
            </span>
            {!isLoading && !error && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-green-600 font-medium">LIVE</span>
              </div>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 mb-4 p-4 bg-gradient-to-r from-stone-50 to-stone-100 dark:from-stone-900 dark:to-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-stone-900/10 dark:bg-stone-100/10">
                <svg
                  className="w-4 h-4 text-stone-700 dark:text-stone-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
              </div>
              <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                Filters
              </span>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-stone-600 dark:text-stone-400">
                    Health Checks
                  </span>
                  <Switch
                    checked={filters.showHealthChecks}
                    onCheckedChange={(checked) =>
                      setFilters((p) => ({ ...p, showHealthChecks: checked }))
                    }
                    className="data-[state=checked]:bg-green-600 dark:data-[state=checked]:bg-green-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-stone-600 dark:text-stone-400">
                    Metrics
                  </span>
                  <Switch
                    checked={filters.showMetrics}
                    onCheckedChange={(checked) =>
                      setFilters((p) => ({ ...p, showMetrics: checked }))
                    }
                    className="data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-blue-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-stone-600 dark:text-stone-400">
                    Errors
                  </span>
                  <Switch
                    checked={filters.showErrors}
                    onCheckedChange={(checked) =>
                      setFilters((p) => ({ ...p, showErrors: checked }))
                    }
                    className="data-[state=checked]:bg-red-600 dark:data-[state=checked]:bg-red-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 min-h-0 flex flex-col"
        >
          <TabsList className="grid w-full grid-cols-3 shrink-0 mb-4">
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>
          <div className="flex-1 min-h-0 overflow-auto">
            {renderContent()}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
