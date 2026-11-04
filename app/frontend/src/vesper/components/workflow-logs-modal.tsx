// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useNavigate } from "react-router-dom";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Spinner } from "@tenstorrent/vesper/icons";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { Typography } from "@tenstorrent/vesper/typography";
import { useWorkflowLogStream } from "@/src/hooks/useWorkflowLogStream";
import { ControlledModal } from "@/src/vesper/components/controlled-modal";
import { LogLevelFilter } from "@/src/vesper/components/log-level-filter";
import { LogViewer } from "@/src/vesper/components/log-viewer";
import { useLogLevelFilter } from "@/src/vesper/hooks/use-log-level-filter";
import { DEPLOYMENT_HISTORY_PATH } from "@/src/routes/route-config";

export interface WorkflowLogsTarget {
  deploymentId: number;
  modelName?: string;
  diedUnexpectedly?: boolean;
  failureReason?: string | null;
  failureMessage?: string | null;
  hfUrl?: string | null;
}

/**
 * The workflow log of a deployment: the output of the inference server run that
 * started it. This is what's left to look at once a container is gone.
 */
export function WorkflowLogsModal({
  target,
  onClose,
}: {
  target: WorkflowLogsTarget | null;
  onClose(): void;
}) {
  const navigate = useNavigate();
  const open = target !== null;
  const { logs, error, isLoading, isComplete } = useWorkflowLogStream(
    open,
    target?.deploymentId ?? null
  );
  const { filter, ...levelFilter } = useLogLevelFilter(logs);

  const isHfFailure =
    target?.failureReason === "hf_auth" ||
    target?.failureReason === "hf_model_not_found";

  return (
    <ControlledModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={
        target?.modelName
          ? `Workflow logs: ${target.modelName}`
          : "Workflow logs"
      }
      description="Output from the inference server run that started this deployment."
      width={1040}
      maxHeight="90vh"
    >
      <div className="flex flex-col gap-vesper-4 pt-vesper-2">
        {target?.diedUnexpectedly && (
          <Admonition
            variant="danger"
            ctaAs="button"
            cta={{
              children: "View deployment history",
              onClick: () => {
                onClose();
                navigate(DEPLOYMENT_HISTORY_PATH);
              },
            }}
          >
            This model stopped without being shut down. It may have crashed, run
            out of memory, or hit a hardware fault. Reset the device before
            deploying a new model.
          </Admonition>
        )}
        {isHfFailure && (
          <Admonition variant="warning">
            {target?.failureMessage ??
              "Your Hugging Face token doesn't have access to this model's weights."}
            {target?.hfUrl && (
              <>
                {" "}
                <a
                  className="text-vesper-text-link-default underline"
                  href={target.hfUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Request access on Hugging Face
                </a>
              </>
            )}
          </Admonition>
        )}
        <LogLevelFilter
          {...levelFilter}
          status={
            isLoading ? (
              <StatusIndicator state="queued" label="Loading" animated />
            ) : isComplete ? (
              <StatusIndicator state="cancelled" label="End of log" />
            ) : !error ? (
              <StatusIndicator state="ready" label="Live" animated />
            ) : null
          }
        />
        {error && (
          <Admonition variant="danger" size="sm">
            {error}
          </Admonition>
        )}
        <LogViewer
          className="h-[52vh]"
          lines={logs}
          filter={filter}
          emptyState={
            isLoading ? (
              <Typography
                variant="label-sm-mono"
                className="flex items-center gap-vesper-2 text-vesper-text-tertiary"
              >
                <Spinner className="w-4 h-4 animate-spin" />
                Loading the workflow log…
              </Typography>
            ) : undefined
          }
        />
      </div>
    </ControlledModal>
  );
}
