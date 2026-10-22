// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Spinner } from "@tenstorrent/vesper/icons";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { Switch } from "@tenstorrent/vesper/switch";
import { Tabs } from "@tenstorrent/vesper/tabs";
import { Typography } from "@tenstorrent/vesper/typography";
import { useLogStream } from "@/src/hooks/useLogStream";
import { ControlledModal } from "@/src/vesper/components/controlled-modal";
import { LogViewer } from "@/src/vesper/components/log-viewer";

/** Live logs, events and metrics streamed from a running model container. */
export function ContainerLogsModal({
  open,
  onOpenChange,
  containerId,
  modelName,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  containerId: string | null;
  modelName?: string;
}) {
  const [tab, setTab] = useState("logs");
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

  const connecting = (
    <Typography
      variant="label-sm-mono"
      className="flex items-center gap-vesper-2 text-vesper-text-tertiary"
    >
      <Spinner className="w-4 h-4 animate-spin" />
      Connecting to the log stream…
    </Typography>
  );

  const metricsEntries = Object.entries(metrics);

  return (
    <ControlledModal
      open={open}
      onOpenChange={onOpenChange}
      title={modelName ? `Logs: ${modelName}` : "Logs"}
      description="Live output from the model's container."
      width={1040}
      maxHeight="90vh"
      buttons={
        error
          ? [
              { children: "Close", onClick: () => onOpenChange(false) },
              {
                children: "Retry",
                variant: "contrast",
                onClick: () => setReloadKey((k) => k + 1),
              },
            ]
          : undefined
      }
    >
      <div className="flex flex-col gap-vesper-4 pt-vesper-2">
        <div className="flex flex-wrap items-center gap-x-vesper-6 gap-y-vesper-3">
          {isLoading ? (
            <StatusIndicator state="queued" label="Connecting" animated />
          ) : error ? (
            <StatusIndicator state="error" label="Disconnected" />
          ) : (
            <StatusIndicator state="ready" label="Live" animated />
          )}
          <div className="ml-auto flex flex-wrap items-center gap-vesper-6">
            <Switch
              size="sm"
              label="Health checks"
              checked={filters.showHealthChecks}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  showHealthChecks: e.target.checked,
                }))
              }
            />
            <Switch
              size="sm"
              label="Metrics"
              checked={filters.showMetrics}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  showMetrics: e.target.checked,
                }))
              }
            />
            <Switch
              size="sm"
              label="Errors"
              checked={filters.showErrors}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  showErrors: e.target.checked,
                }))
              }
            />
          </div>
        </div>
        {error && (
          <Admonition variant="danger" size="sm">
            {error}
          </Admonition>
        )}
        <Tabs
          variant="secondary"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              value: "logs",
              label: `Logs${logs.length ? ` (${logs.length})` : ""}`,
              content: (
                <LogViewer
                  className="h-[52vh] pt-vesper-3"
                  lines={logs}
                  filter={filterLog}
                  emptyState={isLoading ? connecting : undefined}
                />
              ),
            },
            {
              value: "events",
              label: `Events${events.length ? ` (${events.length})` : ""}`,
              content: (
                <LogViewer
                  className="h-[52vh] pt-vesper-3"
                  lines={events}
                  filter={filterLog}
                  emptyState={
                    isLoading ? (
                      connecting
                    ) : (
                      <Typography
                        variant="copy-sm"
                        className="text-vesper-text-tertiary"
                      >
                        No events yet.
                      </Typography>
                    )
                  }
                />
              ),
            },
            {
              value: "metrics",
              label: "Metrics",
              content: (
                <div className="h-[52vh] pt-vesper-3 overflow-auto">
                  {metricsEntries.length === 0 ? (
                    <Typography
                      variant="copy-sm"
                      className="text-vesper-text-tertiary"
                    >
                      Metrics collection is not yet supported for this container
                      type.
                    </Typography>
                  ) : (
                    <dl className="grid grid-cols-2 md:grid-cols-3 gap-vesper-3">
                      {metricsEntries.map(([name, value]) => (
                        <div
                          key={name}
                          className="flex flex-col gap-vesper-2 rounded-vesper-2 border border-vesper-border-secondary p-vesper-4"
                        >
                          <Typography
                            as="dt"
                            variant="label-xs-mono"
                            className="uppercase text-vesper-text-tertiary"
                          >
                            {name.replace(/_/g, " ")}
                          </Typography>
                          <Typography
                            as="dd"
                            variant="label-lg-bold"
                            className="text-vesper-text-primary"
                          >
                            {typeof value === "number"
                              ? value.toLocaleString()
                              : String(value)}
                          </Typography>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>
    </ControlledModal>
  );
}
