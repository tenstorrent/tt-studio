// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useQuery } from "@tanstack/react-query";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Spinner } from "@tenstorrent/vesper/icons";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { Typography } from "@tenstorrent/vesper/typography";
import { ControlledModal } from "@/src/vesper/components/controlled-modal";
import { LogLevelFilter } from "@/src/vesper/components/log-level-filter";
import { LogViewer } from "@/src/vesper/components/log-viewer";
import { useLogLevelFilter } from "@/src/vesper/hooks/use-log-level-filter";

export interface JobLogsTarget {
  jobId: string;
  modelName?: string;
}

interface JobLogEntry {
  /** Seconds since the epoch */
  timestamp?: number | null;
  level?: string | null;
  message?: string | null;
}

const NO_LINES: string[] = [];

/** `[12:03:04] [ERROR] message`, so the log viewer can pick out the level. */
function formatEntry(entry: JobLogEntry) {
  const time = entry.timestamp
    ? `[${new Date(entry.timestamp * 1000).toLocaleTimeString()}] `
    : "";
  const level = entry.level ? `[${entry.level.toUpperCase()}] ` : "";
  return `${time}${level}${entry.message ?? ""}`;
}

async function fetchJobLogs(jobId: string): Promise<string[]> {
  const response = await fetch(
    `/docker-api/deploy/logs/${encodeURIComponent(jobId)}/`
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `HTTP ${response.status}`);
  }
  return ((data?.logs ?? []) as JobLogEntry[]).map(formatEntry);
}

/**
 * The inference server's log of a deploy job, for deploys that have no
 * container (yet, or ever, when one fails during the download or start-up).
 * The server keeps the most recent 50 messages of each job.
 */
export function JobLogsModal({
  target,
  live,
  onClose,
}: {
  target: JobLogsTarget | null;
  /** Keep refreshing while the deploy is still running */
  live: boolean;
  onClose(): void;
}) {
  const open = target !== null;
  const logs = useQuery({
    queryKey: ["deploy-job-logs", target?.jobId],
    queryFn: () => fetchJobLogs(target!.jobId),
    enabled: open,
    refetchInterval: live ? 3_000 : false,
    retry: false,
  });
  const lines = logs.data ?? NO_LINES;
  const { filter, ...levelFilter } = useLogLevelFilter(lines);

  return (
    <ControlledModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={
        target?.modelName
          ? `Deployment logs: ${target.modelName}`
          : "Deployment logs"
      }
      description="Recent output from the inference server for this deployment, before its container is running."
      width={1040}
      maxHeight="90vh"
    >
      <div className="flex flex-col gap-vesper-4 pt-vesper-2">
        <LogLevelFilter
          {...levelFilter}
          status={
            logs.isPending ? (
              <StatusIndicator state="queued" label="Loading" animated />
            ) : live && !logs.isError ? (
              <StatusIndicator state="ready" label="Live" animated />
            ) : null
          }
        />
        {logs.isError && (
          <Admonition variant="danger" size="sm">
            Couldn't load the logs: {logs.error.message}
          </Admonition>
        )}
        <LogViewer
          className="h-[52vh]"
          lines={lines}
          filter={filter}
          emptyState={
            logs.isPending ? (
              <Typography
                variant="label-sm-mono"
                className="flex items-center gap-vesper-2 text-vesper-text-tertiary"
              >
                <Spinner className="w-4 h-4 animate-spin" />
                Loading the deployment log…
              </Typography>
            ) : (
              <Typography
                variant="label-sm-mono"
                className="text-vesper-text-tertiary"
              >
                No log output for this deployment yet.
              </Typography>
            )
          }
        />
      </div>
    </ControlledModal>
  );
}
