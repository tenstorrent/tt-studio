// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  XCircle,
  Download,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Ban,
  RefreshCw,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  fetchTrainingJob,
  fetchTrainingJobMetrics,
  fetchTrainingJobLogs,
  fetchTrainingJobCheckpoints,
  cancelTrainingJob,
  getCheckpointDownloadUrl,
  formatTrainingTimestamp,
  getJobDataset,
  getJobErrorMessage,
  type TrainingJob,
  type TrainingMetricPoint,
  type TrainingLogEntry,
  type TrainingCheckpoint,
} from "../api/trainingApi";
import { customToast } from "../components/CustomToaster";

// ---------------------------------------------------------------------------
// Status Badge (shared with TrainingPage)
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<
  string,
  { label: string; color: string; bg: string; icon: React.ElementType }
> = {
  queued: {
    label: "Queued",
    color: "text-yellow-700 dark:text-yellow-300",
    bg: "bg-yellow-100 dark:bg-yellow-900/30",
    icon: Clock,
  },
  in_progress: {
    label: "Running",
    color: "text-blue-700 dark:text-blue-300",
    bg: "bg-blue-100 dark:bg-blue-900/30",
    icon: Loader2,
  },
  completed: {
    label: "Completed",
    color: "text-green-700 dark:text-green-300",
    bg: "bg-green-100 dark:bg-green-900/30",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    color: "text-red-700 dark:text-red-300",
    bg: "bg-red-100 dark:bg-red-900/30",
    icon: AlertTriangle,
  },
  cancelling: {
    label: "Cancelling",
    color: "text-orange-700 dark:text-orange-300",
    bg: "bg-orange-100 dark:bg-orange-900/30",
    icon: Loader2,
  },
  cancelled: {
    label: "Cancelled",
    color: "text-gray-600 dark:text-gray-400",
    bg: "bg-gray-100 dark:bg-gray-800/50",
    icon: Ban,
  },
};

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_STYLES[status] ?? STATUS_STYLES.queued;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${cfg.color} ${cfg.bg}`}
    >
      <Icon
        className={`h-4 w-4 ${
          status === "in_progress" || status === "cancelling"
            ? "animate-spin"
            : ""
        }`}
      />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Log level coloring
// ---------------------------------------------------------------------------

function logLevelClass(level?: string): string {
  const l = (level ?? "").toLowerCase();
  if (l === "error") return "text-red-500";
  if (l === "warning" || l === "warn") return "text-yellow-500";
  if (l === "eval" || l === "validation") return "text-cyan-400";
  if (l === "checkpoint") return "text-purple-400";
  return "text-gray-300";
}

function formatLogTime(value: number | string): string {
  const date =
    typeof value === "number"
      ? new Date(value < 1e12 ? value * 1000 : value)
      : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString();
}

// ---------------------------------------------------------------------------
// Format bytes
// ---------------------------------------------------------------------------

function formatBytes(bytes?: number): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function TrainingJobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<TrainingJob | null>(null);
  const [metrics, setMetrics] = useState<TrainingMetricPoint[]>([]);
  const [logs, setLogs] = useState<TrainingLogEntry[]>([]);
  const [checkpoints, setCheckpoints] = useState<TrainingCheckpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const isActive = job?.status === "queued" || job?.status === "in_progress";
  const isTerminal = job ? TERMINAL_STATUSES.includes(job.status) : false;
  // Show "Cancelling" optimistically: the backend keeps reporting the previous
  // status (queued / in_progress) for a few seconds after a cancel request, so
  // we override the displayed status until it reaches a terminal state.
  const displayStatus =
    cancelRequested && !isTerminal ? "cancelling" : job?.status ?? "queued";

  const loadAll = useCallback(async () => {
    if (!jobId) return;
    try {
      const [j, m, l, c] = await Promise.all([
        fetchTrainingJob(jobId),
        fetchTrainingJobMetrics(jobId),
        fetchTrainingJobLogs(jobId),
        fetchTrainingJobCheckpoints(jobId),
      ]);
      setJob(j);
      setMetrics(m);
      setLogs(l);
      setCheckpoints(c);
      setConnectionError(null);
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error;
      if (status === 502 || status === 504) {
        setConnectionError(
          "Training container is not reachable. It may have stopped or restarted.",
        );
      } else if (status === 404 && msg?.includes("No running training container")) {
        setConnectionError(
          "Training container is no longer running. The job data is unavailable.",
        );
      } else if (!job) {
        console.error("Failed to load job details:", err);
        customToast.error("Failed to load job details");
      }
    } finally {
      setLoading(false);
    }
  }, [jobId, job]);

  useEffect(() => {
    loadAll();
    if (!isActive && job !== null) return;
    const id = setInterval(loadAll, 5_000);
    return () => clearInterval(id);
  }, [loadAll, isActive, job]);

  // Keep the logs pinned to the bottom only while auto-scroll is enabled.
  // Scroll the container itself (not scrollIntoView) so the page doesn't jump.
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      const el = logsContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, autoScroll]);

  // When the user scrolls up, pause auto-scroll so they can read earlier logs;
  // re-enable it once they scroll back to the bottom.
  const handleLogsScroll = useCallback(() => {
    const el = logsContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  const handleCancel = async () => {
    if (!jobId) return;
    setCancelRequested(true);
    try {
      const result = await cancelTrainingJob(jobId);
      // The server flips the job to "cancelling" and returns the new status in
      // the cancel response. Apply it directly so the UI reflects the server's
      // authoritative status without waiting for the next poll.
      if (result?.status) {
        setJob((prev) => (prev ? { ...prev, status: result.status as TrainingJob["status"] } : prev));
      }
      customToast.success("Cancellation requested");
      loadAll();
    } catch {
      setCancelRequested(false);
      customToast.error("Failed to cancel job");
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-lg text-gray-500">Job not found</p>
        <Button variant="outline" onClick={() => navigate("/training")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Jobs
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full px-6 py-8 lg:px-12">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Action Bar */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => navigate("/training")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Jobs
          </Button>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={loadAll}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            {isActive && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancel}
                disabled={cancelRequested}
              >
                {cancelRequested ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                {cancelRequested ? "Cancelling..." : "Cancel Job"}
              </Button>
            )}
          </div>
        </div>

        {/* Connection error banner */}
        {connectionError && (
          <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-900/20">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              {connectionError}
            </p>
          </div>
        )}

        {/* A. Job Info Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">
                Job{" "}
                <span className="font-mono text-base text-gray-500">
                  {job.id.slice(0, 12)}
                </span>
              </CardTitle>
              <StatusBadge status={displayStatus} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Model</span>
                <p className="font-medium">{job.model}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">
                  Dataset
                </span>
                <p className="font-medium">{getJobDataset(job)}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">
                  Created
                </span>
                <p className="font-medium">
                  {formatTrainingTimestamp(job.created_at)}
                </p>
              </div>
              {job.completed_at && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">
                    Completed
                  </span>
                  <p className="font-medium">
                    {formatTrainingTimestamp(job.completed_at)}
                  </p>
                </div>
              )}
              {job.progress && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">
                    Progress
                  </span>
                  <p className="font-medium">
                    Step {job.progress.current_step} /{" "}
                    {job.progress.total_steps}
                  </p>
                </div>
              )}
              {job.error && (
                <div className="col-span-full">
                  <span className="text-red-500">Error</span>
                  <p className="font-mono text-xs text-red-400">
                    {getJobErrorMessage(job.error)}
                  </p>
                </div>
              )}
            </div>

            {/* Hyperparameters summary */}
            {(() => {
              const config = job.config ?? job.request_parameters;
              if (!config || Object.keys(config).length === 0) return null;
              const HIDDEN_CONFIG_KEYS = ["lora_task_type", "ignored_index"];
              const visibleEntries = Object.entries(config).filter(
                ([k]) => !HIDDEN_CONFIG_KEYS.includes(k),
              );
              if (visibleEntries.length === 0) return null;
              return (
                <div className="mt-4 border-t pt-4 dark:border-gray-700">
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Configuration
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {visibleEntries.map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-800"
                      >
                        <span className="text-gray-500 dark:text-gray-400">
                          {k}:
                        </span>{" "}
                        {String(v)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Tabbed panels */}
        <Tabs defaultValue="metrics">
          <TabsList>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="checkpoints">
              Checkpoints ({checkpoints.length})
            </TabsTrigger>
          </TabsList>

          {/* B. Metrics Chart */}
          <TabsContent value="metrics">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Loss</CardTitle>
              </CardHeader>
              <CardContent>
                {metrics.length === 0 ? (
                  <p className="py-8 text-center text-gray-500">
                    No metrics data yet.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={350}>
                    <LineChart data={metrics}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#374151"
                        opacity={0.3}
                      />
                      <XAxis
                        dataKey="global_step"
                        label={{
                          value: "Step",
                          position: "insideBottomRight",
                          offset: -5,
                        }}
                        stroke="#9CA3AF"
                        fontSize={12}
                      />
                      <YAxis stroke="#9CA3AF" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1F2937",
                          border: "1px solid #374151",
                          borderRadius: "8px",
                          color: "#F9FAFB",
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="train_loss"
                        name="Train Loss"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        dot={
                          metrics.filter((m) => m.train_loss != null).length ===
                          1
                        }
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="val_loss"
                        name="Val Loss"
                        stroke="#F59E0B"
                        strokeWidth={2}
                        dot={
                          metrics.filter((m) => m.val_loss != null).length === 1
                        }
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Learning rate (separate chart) */}
            {metrics.some((m) => m.learning_rate != null) && (
              <Card className="mt-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Learning Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={metrics}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#374151"
                        opacity={0.3}
                      />
                      <XAxis
                        dataKey="global_step"
                        label={{
                          value: "Step",
                          position: "insideBottomRight",
                          offset: -5,
                        }}
                        stroke="#9CA3AF"
                        fontSize={12}
                      />
                      <YAxis
                        stroke="#9CA3AF"
                        fontSize={12}
                        width={70}
                        tickFormatter={(v) =>
                          typeof v === "number" ? v.toExponential(1) : v
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#1F2937",
                          border: "1px solid #374151",
                          borderRadius: "8px",
                          color: "#F9FAFB",
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="learning_rate"
                        name="Learning Rate"
                        stroke="#10B981"
                        strokeWidth={2}
                        dot={
                          metrics.filter((m) => m.learning_rate != null)
                            .length === 1
                        }
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* C. Logs Panel */}
          <TabsContent value="logs">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg">Logs</CardTitle>
                <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded"
                  />
                  Auto-scroll
                </label>
              </CardHeader>
              <CardContent>
                <div
                  ref={logsContainerRef}
                  onScroll={handleLogsScroll}
                  className="max-h-[400px] overflow-y-auto rounded bg-gray-950 p-4 font-mono text-xs leading-relaxed"
                >
                  {logs.length === 0 ? (
                    <p className="text-gray-500">No logs yet.</p>
                  ) : (
                    logs.map((entry, i) => {
                      const level = entry.level ?? entry.type ?? "info";
                      return (
                        <div key={i} className="flex gap-3">
                          <span className="shrink-0 text-gray-600">
                            {formatLogTime(entry.timestamp)}
                          </span>
                          <span
                            className={`shrink-0 w-14 uppercase ${logLevelClass(level)}`}
                          >
                            {level}
                          </span>
                          <span className="text-gray-200">
                            {entry.message}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* D. Checkpoints Table */}
          <TabsContent value="checkpoints">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Checkpoints</CardTitle>
              </CardHeader>
              <CardContent>
                {checkpoints.length === 0 ? (
                  <p className="py-8 text-center text-gray-500">
                    No checkpoints saved yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          <th className="py-3 pr-4">Step</th>
                          <th className="py-3 pr-4">Epoch</th>
                          <th className="py-3 pr-4">Metrics</th>
                          <th className="py-3 pr-4">Size</th>
                          <th className="py-3 pr-4">Created</th>
                          <th className="py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {checkpoints.map((ckpt) => (
                          <tr key={ckpt.id}>
                            <td className="py-3 pr-4 font-mono">
                              {ckpt.step}
                            </td>
                            <td className="py-3 pr-4">
                              {ckpt.epoch ?? "-"}
                            </td>
                            <td className="py-3 pr-4">
                              {ckpt.metrics ? (
                                <span className="flex flex-wrap gap-1">
                                  {Object.entries(ckpt.metrics).map(
                                    ([k, v]) => (
                                      <span
                                        key={k}
                                        className="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-800"
                                      >
                                        {k}:{" "}
                                        {typeof v === "number"
                                          ? v.toFixed(4)
                                          : String(v)}
                                      </span>
                                    ),
                                  )}
                                </span>
                              ) : (
                                "-"
                              )}
                            </td>
                            <td className="py-3 pr-4 text-gray-500 dark:text-gray-400">
                              {formatBytes(ckpt.size_bytes)}
                            </td>
                            <td className="py-3 pr-4 text-gray-500 dark:text-gray-400">
                              {formatTrainingTimestamp(ckpt.created_at)}
                            </td>
                            <td className="py-3 text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                asChild
                              >
                                <a
                                  href={getCheckpointDownloadUrl(
                                    jobId!,
                                    ckpt.id,
                                  )}
                                  download={`training_job_${jobId!.slice(0, 6)}_${ckpt.id}.zip`}
                                >
                                  <Download className="mr-1 h-3 w-3" />
                                  Download
                                </a>
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
