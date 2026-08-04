// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Plus,
  RefreshCw,
  XCircle,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Ban,
  ServerOff,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  fetchTrainingJobs,
  cancelTrainingJob,
  formatTrainingTimestamp,
  getJobDataset,
  type TrainingJob,
} from "../api/trainingApi";
import { customToast } from "../components/CustomToaster";
import { TrainingConfigDialog } from "../components/training/TrainingConfigDialog";

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

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_STYLES[status] ?? STATUS_STYLES.queued;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.color} ${cfg.bg}`}
    >
      <Icon
        className={`h-3 w-3 ${status === "in_progress" || status === "cancelling" ? "animate-spin" : ""}`}
      />
      {cfg.label}
    </span>
  );
}

export default function TrainingPage() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [noContainer, setNoContainer] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const data = await fetchTrainingJobs();
      setJobs(data);
      setNoContainer(false);
      setApiError(null);
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error;
      if (status === 404 && msg?.includes("No running training container")) {
        setNoContainer(true);
        setApiError(null);
      } else if (status === 502) {
        setApiError("Training container is not reachable. It may be starting up or has stopped.");
      } else {
        console.error("Failed to fetch training jobs:", err);
        setApiError(msg || "Failed to connect to training service.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const hasActiveJobs = jobs.some(
    (j) =>
      j.status === "queued" ||
      j.status === "in_progress" ||
      j.status === "cancelling",
  );

  useEffect(() => {
    loadJobs();
    const interval = hasActiveJobs ? 10_000 : 30_000;
    const id = setInterval(loadJobs, interval);
    return () => clearInterval(id);
  }, [loadJobs, hasActiveJobs]);

  const handleCancel = async (jobId: string) => {
    try {
      await cancelTrainingJob(jobId);
      customToast.success("Cancellation requested");
      loadJobs();
    } catch {
      customToast.error("Failed to cancel job");
    }
  };

  const handleJobCreated = () => {
    setDialogOpen(false);
    loadJobs();
    customToast.success("Training job submitted");
  };

  return (
    <div className="min-h-screen w-full px-6 py-8 lg:px-12">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              Training Jobs
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Fine-tune models on Tenstorrent hardware
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={loadJobs}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Training Job
            </Button>
          </div>
        </div>

        {/* No training container deployed */}
        {noContainer && (
          <Card className="border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
            <CardContent className="flex items-center gap-4 py-6">
              <ServerOff className="h-8 w-8 shrink-0 text-amber-500" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  No training container is running
                </p>
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                  Deploy a training model first to start fine-tuning jobs.{" "}
                  <Link
                    to="/models-deployed"
                    className="underline font-medium hover:text-amber-900 dark:hover:text-amber-100"
                  >
                    Go to Models Deployed
                  </Link>
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* API connectivity error */}
        {apiError && !noContainer && (
          <Card className="border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20">
            <CardContent className="flex items-center gap-4 py-6">
              <AlertTriangle className="h-8 w-8 shrink-0 text-red-500" />
              <div>
                <p className="font-medium text-red-800 dark:text-red-200">
                  Training service unavailable
                </p>
                <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                  {apiError}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Jobs table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading jobs...
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
                <p className="text-lg font-medium">No training jobs yet</p>
                <p className="mt-1 text-sm">
                  Click &quot;New Training Job&quot; to get started.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      <th className="py-3 pr-4">Job ID</th>
                      <th className="py-3 pr-4">Model</th>
                      <th className="py-3 pr-4">Dataset</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3 pr-4">Created</th>
                      <th className="py-3 pr-4">Progress</th>
                      <th className="py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {jobs.map((job) => (
                      <tr
                        key={job.id}
                        className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        onClick={() => navigate(`/training/${job.id}`)}
                      >
                        <td className="py-3 pr-4 font-mono text-xs">
                          {job.id.slice(0, 8)}
                        </td>
                        <td className="py-3 pr-4 font-medium">
                          {job.model}
                        </td>
                        <td className="py-3 pr-4">{getJobDataset(job)}</td>
                        <td className="py-3 pr-4">
                          <StatusBadge status={job.status} />
                        </td>
                        <td className="py-3 pr-4 text-gray-500 dark:text-gray-400">
                          {formatTrainingTimestamp(job.created_at)}
                        </td>
                        <td className="py-3 pr-4 text-gray-500 dark:text-gray-400">
                          {job.progress
                            ? `${job.progress.current_step} / ${job.progress.total_steps}`
                            : "-"}
                        </td>
                        <td className="py-3 text-right">
                          {(job.status === "queued" ||
                            job.status === "in_progress") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancel(job.id);
                              }}
                            >
                              <XCircle className="mr-1 h-4 w-4" />
                              Cancel
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* New Job Dialog */}
      <TrainingConfigDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onJobCreated={handleJobCreated}
      />
    </div>
  );
}
