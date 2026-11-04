// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, type ReactNode } from "react";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Button } from "@tenstorrent/vesper/button";
import { ArrowRight, ArrowUpRight, Reset } from "@tenstorrent/vesper/icons";
import { Skeleton } from "@tenstorrent/vesper/skeleton";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { Tag } from "@tenstorrent/vesper/tag";
import { TextButton } from "@tenstorrent/vesper/text-button";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import { EmptyPill } from "@/src/vesper/components/empty-pill";
import {
  WorkflowLogsModal,
  type WorkflowLogsTarget,
} from "@/src/vesper/components/workflow-logs-modal";
import {
  diedUnexpectedly,
  useDeploymentHistory,
  type DeploymentHistoryRecord,
} from "@/src/vesper/hooks/use-deployment-history";
import { formatDateTime, formatDuration } from "@/src/vesper/utils/format";

const COLUMNS = [
  "Model Name",
  "Device",
  "Status",
  "Deployed at",
  "Stopped at",
  "Duration",
  "Port",
];

function DeploymentStatus({ record }: { record: DeploymentHistoryRecord }) {
  if (record.status === "running") {
    return (
      <StatusIndicator
        className="[&_.vesper-status-indicator-label]:font-vesper-mono [&_.vesper-status-indicator-label]:text-xs"
        state="ready"
        label="Active"
      />
    );
  }
  if (record.status === "stopped" && record.stopped_by_user) {
    return <Tag size="sm">Terminated</Tag>;
  }

  let reason: string | null = null;
  let details: string | null = null;
  if (record.failure_reason === "hf_auth") {
    reason =
      record.failure_message ??
      "Your Hugging Face token doesn't have access to this model's weights.";
  } else if (record.failure_reason === "hf_model_not_found") {
    reason =
      record.failure_message ??
      "The model repository wasn't found on Hugging Face.";
  } else if (diedUnexpectedly(record)) {
    reason =
      "The container exited without being stopped. This may be an out-of-memory error, a crash, or a hardware issue.";
    // the backend's own account of the exit, e.g. its last error lines
    details = record.failure_message;
  }
  if (!reason) return <Tag size="sm">{record.status}</Tag>;

  // no access to the weights: the tag opens the model's Hugging Face page,
  // where access is requested
  const accessUrl = record.failure_reason === "hf_auth" ? record.hf_url : null;

  const content = (
    <span className="flex flex-col gap-vesper-2">
      <span>{reason}</span>
      {details && (
        <span className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-vesper-mono text-xs">
          {details}
        </span>
      )}
      {accessUrl && <span>Click to request access on Hugging Face.</span>}
    </span>
  );

  return (
    <Tooltip content={content} maxWidth={details ? 420 : 320}>
      {accessUrl ? (
        <Tag
          size="sm"
          variant="danger-subtle"
          as="a"
          href={accessUrl}
          target="_blank"
          rel="noreferrer"
          icon={<ArrowUpRight />}
        >
          Failed
        </Tag>
      ) : (
        <Tag size="sm" variant="danger-subtle" as="button" type="button">
          Failed
        </Tag>
      )}
    </Tooltip>
  );
}

export default function DeploymentHistoryPage() {
  const history = useDeploymentHistory();
  const [logs, setLogs] = useState<WorkflowLogsTarget | null>(null);
  const deployments = history.data?.deployments ?? [];

  const openLogs = (record: DeploymentHistoryRecord) =>
    setLogs({
      deploymentId: record.id,
      modelName: record.model_name,
      diedUnexpectedly: diedUnexpectedly(record),
      failureReason: record.failure_reason,
      failureMessage: record.failure_message,
      hfUrl: record.hf_url,
    });

  return (
    <div className="min-h-full flex flex-col gap-vesper-6 px-vesper-16 py-vesper-6 text-left">
      {history.isError && (
        <Admonition variant="warning" subtle>
          Deployment history is currently unavailable.
          {deployments.length > 0 && " Showing the last history that loaded."}
        </Admonition>
      )}
      <div className="flex justify-end pt-vesper-10">
        <Button
          type="button"
          size="sm"
          variant="subtle"
          iconLeft={
            <Reset className={cn(history.isFetching && "animate-spin")} />
          }
          disabled={history.isFetching}
          onClick={() => void history.refetch()}
        >
          Refresh
        </Button>
      </div>
      <div className="rounded-vesper-4 bg-vesper-background-secondary p-vesper-6 overflow-x-auto">
        <table className="w-full min-w-[56rem] border-separate border-spacing-0">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-vesper-4 pb-vesper-4 border-b border-vesper-border-secondary text-left font-normal"
                >
                  <Typography
                    as="span"
                    variant="label-md"
                    className="text-vesper-text-secondary"
                  >
                    {column}
                  </Typography>
                </th>
              ))}
              <th
                scope="col"
                className="pb-vesper-4 border-b border-vesper-border-secondary"
              >
                <span className="sr-only">Logs</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr aria-hidden>
              <td colSpan={COLUMNS.length + 1} className="h-vesper-4" />
            </tr>
            {history.isPending &&
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={COLUMNS.length + 1} className="py-vesper-2">
                    <Skeleton height={40} />
                  </td>
                </tr>
              ))}
            {history.isSuccess && deployments.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="h-72 text-center">
                  <EmptyPill>No Deployment History</EmptyPill>
                </td>
              </tr>
            )}
            {deployments.map((record) => (
              <tr
                key={record.id}
                className="group odd:[&>td]:bg-vesper-tint-neutral-200 [&>td:first-child]:rounded-l-vesper-2 [&>td:last-child]:rounded-r-vesper-2"
              >
                <Cell>
                  <Typography
                    as="span"
                    variant="label-md"
                    className="text-vesper-text-primary"
                  >
                    {record.model_name}
                  </Typography>
                </Cell>
                <Cell>{record.device || "---"}</Cell>
                <Cell>
                  <DeploymentStatus record={record} />
                </Cell>
                <Cell>{formatDateTime(record.deployed_at) ?? "---"}</Cell>
                <Cell>{formatDateTime(record.stopped_at) ?? "---"}</Cell>
                <Cell>
                  {record.stopped_at
                    ? (formatDuration(
                        Date.parse(record.stopped_at) -
                          Date.parse(record.deployed_at)
                      ) ?? "---")
                    : "---"}
                </Cell>
                <Cell>{record.port ?? "---"}</Cell>
                <td className="px-vesper-4 py-vesper-4 text-right">
                  <TextButton
                    type="button"
                    size="sm"
                    variant="contrast"
                    className="font-vesper-mono uppercase whitespace-nowrap"
                    iconRight={<ArrowRight />}
                    disabled={!record.workflow_log_path}
                    title={
                      record.workflow_log_path
                        ? undefined
                        : "Logs not available"
                    }
                    onClick={() => openLogs(record)}
                  >
                    View logs
                  </TextButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history.data && history.data.count > 0 && (
        <Typography variant="label-xs" className="text-vesper-text-tertiary">
          {history.data.count}{" "}
          {history.data.count === 1 ? "deployment" : "deployments"}
        </Typography>
      )}
      <WorkflowLogsModal target={logs} onClose={() => setLogs(null)} />
    </div>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return (
    <td className="px-vesper-4 py-vesper-4 whitespace-nowrap">
      <Typography
        as="span"
        variant="copy-sm"
        className="text-vesper-text-primary"
      >
        {children}
      </Typography>
    </td>
  );
}
