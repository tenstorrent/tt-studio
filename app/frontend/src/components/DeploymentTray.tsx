// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, CheckCircle2, AlertTriangle, X, ChevronDown, Rocket, Copy, Check, Maximize2, Minimize2 } from "lucide-react";
import { Progress } from "./ui/progress";
import type {
  ActiveDeployment,
  DeploymentProgressData,
} from "../hooks/useActiveDeployments";

interface DeploymentTrayProps {
  deployments: ActiveDeployment[];
  progressByJob: Record<string, DeploymentProgressData>;
  onDismiss: (jobId: string) => void;
  onCancel: (jobId: string) => void;
}

/**
 * Floating, minimizable banner (fixed, bottom-right) listing every in-flight and
 * just-finished deployment. Stays mounted across Prev/Next. This subtle list shows
 * all deploys — including the one whose detailed bar is also open in the deploy step.
 */
export function DeploymentTray({ deployments, progressByJob, onDismiss, onCancel }: DeploymentTrayProps) {
  const navigate = useNavigate();
  const [minimized, setMinimized] = useState(false);
  const shown = deployments;
  if (shown.length === 0) return null;

  // Open the single-model deploy step (view=single skips the mode chooser), where
  // the model's full progress bar resumes from the shared deployment state.
  const openDeployment = (d: ActiveDeployment) =>
    navigate(`/?view=single&resume=${encodeURIComponent(d.modelId)}`);

  const activeCount = shown.filter((d) => d.status === "active").length;
  const failedCount = shown.filter((d) => d.status === "failed").length;
  const summary =
    activeCount > 0
      ? `${activeCount} downloading`
      : failedCount > 0
        ? `${failedCount} failed`
        : "Downloads done";

  // bottom-20 keeps the banner (especially the minimized pill) clear of the fixed
  // site footer instead of colliding with it.
  return (
    <div className="fixed bottom-20 right-4 z-50 w-80 max-w-[calc(100vw-2rem)]">
      <AnimatePresence mode="wait" initial={false}>
        {minimized ? (
          <motion.button
            key="pill"
            onClick={() => setMinimized(false)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="ml-auto flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-xs font-medium shadow-lg hover:bg-accent"
          >
            {activeCount > 0 ? (
              <Loader2 className="h-4 w-4 animate-spin text-TT-purple-accent" />
            ) : failedCount > 0 ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
            <span>{summary}</span>
          </motion.button>
        ) : (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden rounded-xl border bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b bg-muted/40 px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <Rocket className="h-4 w-4 text-TT-purple-accent" />
                <span className="text-sm font-semibold">Downloads</span>
                {activeCount > 0 && (
                  <span className="rounded-full bg-TT-purple/10 px-1.5 py-0.5 text-[10px] font-medium text-TT-purple-accent">
                    {activeCount} active
                  </span>
                )}
              </div>
              <button
                onClick={() => setMinimized(true)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Minimize"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
            <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto p-2.5">
              {shown.map((d) => (
                <DeploymentTrayItem
                  key={d.jobId}
                  deployment={d}
                  progress={progressByJob[d.jobId] ?? null}
                  onDismiss={onDismiss}
                  onCancel={onCancel}
                  onOpen={openDeployment}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Mirrors DeploymentProgress's adaptive three-segment bar (image pull → weight download → container start).
function compactPercent(
  p: DeploymentProgressData | null,
  completed: boolean,
  hadImagePull: boolean
): number {
  if (completed) return 100;
  if (!p) return 0;
  const isPull = p.stage === "pulling_image";
  const hasPull = isPull || hadImagePull;
  const [pullLo, pullHi] = hasPull ? [0, 25] : [0, 0];
  const [dlLo, dlHi] = hasPull ? [25, 95] : [0, 95];
  const [startLo, startHi] = [95, 99];
  const frac =
    p.total_bytes && p.downloaded_bytes != null
      ? Math.min(1, Math.max(0, p.downloaded_bytes / p.total_bytes))
      : 0;
  const lerp = (lo: number, hi: number, f: number) =>
    lo + (hi - lo) * Math.min(1, Math.max(0, f));
  const containerStartStages = new Set([
    "image_ready", "container_setup", "container_started", "network_setup", "finalizing", "complete",
  ]);
  if (isPull) return Math.round(lerp(pullLo, pullHi, frac));
  if (p.stage === "model_preparation")
    return Math.round(lerp(dlLo, dlHi, p.weights_cached ? 1 : frac));
  if (containerStartStages.has(p.stage))
    return Math.round(lerp(startLo, startHi, (p.progress ?? 0) / 100));
  return Math.round(hasPull ? pullLo : dlLo);
}

function DeploymentTrayItem({
  deployment,
  progress,
  onDismiss,
  onCancel,
  onOpen,
}: {
  deployment: ActiveDeployment;
  progress: DeploymentProgressData | null;
  onDismiss: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onOpen: (deployment: ActiveDeployment) => void;
}) {
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<string[] | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const isFailed = deployment.status === "failed";
  const isCompleted = deployment.status === "completed";
  const pct = compactPercent(progress, isCompleted, deployment.hadImagePull);

  const deviceLabel =
    deployment.deviceIds.length > 0
      ? `Device ${deployment.deviceIds.slice().sort((a, b) => a - b).join(",")}`
      : null;

  const statusLabel = isFailed ? "Failed" : isCompleted ? "Deployed" : `${pct}%`;

  const fetchLogs = async () => {
    if (showLogs) {
      setShowLogs(false);
      return;
    }
    setShowLogs(true);
    if (logs) return;
    setLoadingLogs(true);
    try {
      const res = await fetch(`/docker-api/deploy/logs/${deployment.jobId}/`);
      if (res.ok) {
        const data = await res.json();
        setLogs(
          (data.logs ?? []).map((log: { timestamp?: number; level: string; message: string }) => {
            const ts = log.timestamp ? new Date(log.timestamp * 1000).toLocaleString() : "";
            return `[${ts}] [${log.level}] ${log.message}`;
          })
        );
      }
    } catch (error) {
      console.error("Error fetching deployment logs:", error);
    } finally {
      setLoadingLogs(false);
    }
  };

  return (
    <div className="rounded-lg border bg-background/60 px-3 py-2.5">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(deployment)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(deployment);
          }
        }}
        aria-label={`View deployment progress for ${deployment.modelName}`}
        title="View deployment progress"
        className="flex cursor-pointer items-center gap-2 rounded text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-TT-purple-accent focus-visible:ring-offset-2"
      >
        {isCompleted ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
        ) : isFailed ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        ) : (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-TT-purple-accent" />
        )}
        <span className="truncate text-sm font-medium">{deployment.modelName}</span>
        <span
          className={`ml-auto shrink-0 tabular-nums ${isFailed ? "text-destructive" : "text-muted-foreground"}`}
        >
          {statusLabel}
        </span>
        {isFailed || isCompleted ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(deployment.jobId);
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel(deployment.jobId);
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
            aria-label="Cancel deployment"
            title="Cancel deployment"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {deviceLabel && (
          <span className="shrink-0 text-[10px] text-muted-foreground">{deviceLabel}</span>
        )}
        {!isFailed && (
          <Progress
            value={pct}
            className="h-2.5 rounded-full"
            indicatorClassName={
              isCompleted
                ? "bg-green-500 dark:bg-green-600"
                : "bg-TT-purple-accent transition-[width] duration-300"
            }
          />
        )}
      </div>

      {isFailed && (
        <button
          onClick={fetchLogs}
          className="mt-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          {showLogs ? "Hide logs" : "View logs"}
        </button>
      )}

      {showLogs && (
        <LogPanel logs={logs} loading={loadingLogs} modelName={deployment.modelName} />
      )}
    </div>
  );
}

/**
 * Deployment logs for one tray item. The tray is a 320px-wide floating panel, which
 * is far too narrow for run.py output — full command lines wrap into an unreadable
 * block. So the panel starts compact and can be expanded to a centred overlay, and
 * every line is copyable in one click for pasting into a bug report.
 */
function LogPanel({
  logs,
  loading,
  modelName,
}: {
  logs: string[] | null;
  loading: boolean;
  modelName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    if (!logs?.length) return;
    try {
      await navigator.clipboard.writeText(logs.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Could not copy deployment logs:", error);
    }
  };

  const body = (
    <div
      className={`overflow-auto rounded bg-gray-950 p-2 font-mono text-green-400 ${
        expanded ? "max-h-[70vh] text-xs" : "max-h-40 text-[10px]"
      }`}
    >
      {loading ? (
        <span className="text-muted-foreground">Loading logs…</span>
      ) : logs && logs.length > 0 ? (
        logs.map((line, i) => (
          // Expanded: keep original line breaks and scroll sideways, so long
          // run.py commands stay on one readable line instead of wrapping.
          <div key={i} className={expanded ? "whitespace-pre" : "whitespace-pre-wrap break-words"}>
            {line}
          </div>
        ))
      ) : (
        <span className="text-muted-foreground">No logs available.</span>
      )}
    </div>
  );

  const controls = (
    <div className="flex items-center gap-2">
      <button
        onClick={copyAll}
        disabled={!logs?.length}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        aria-label="Copy logs"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={expanded ? "Collapse logs" : "Expand logs"}
      >
        {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        {expanded ? "Collapse" : "Expand"}
      </button>
    </div>
  );

  if (!expanded) {
    return (
      <div className="mt-1.5">
        <div className="mb-1 flex justify-end">{controls}</div>
        {body}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={() => setExpanded(false)}
    >
      <div
        className="w-full max-w-4xl rounded-xl border bg-card p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">{modelName} — deployment logs</span>
          {controls}
        </div>
        {body}
      </div>
    </div>
  );
}
