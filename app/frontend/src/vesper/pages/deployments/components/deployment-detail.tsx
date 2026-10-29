// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@tenstorrent/vesper/button";
import { Error as ErrorIcon, Reset } from "@tenstorrent/vesper/icons";
import { ProgressBar } from "@tenstorrent/vesper/progress-bar";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import { DeviceTag } from "@/src/vesper/components/device-tag";
import { ModelLogo } from "@/src/vesper/components/model-logo";
import { useModelActionsPaused } from "@/src/vesper/hooks/use-model-actions-paused";
import type {
  DeploymentItem,
  DeploymentState,
  DemoLink,
} from "@/src/vesper/types";
import { getDemoIcon } from "@/src/vesper/utils/models";
import { DeploymentStatus } from "./deployment-card";

const CARD_BORDER: Record<DeploymentState, string> = {
  downloading: "border-vesper-border-accent-base",
  deploying: "border-vesper-border-warning-base",
  active: "border-vesper-border-secondary",
  "download-failed": "border-vesper-border-error-base",
  "deploy-failed": "border-vesper-border-error-base",
  error: "border-vesper-border-error-base",
};

/** Download or warm-up progress of one model. */
export function ProgressPanel({
  title,
  item,
}: {
  /** Shown above the stage, e.g. the model name within a solution */
  title?: string;
  item: Pick<DeploymentItem, "progress" | "stageLabel" | "transfer">;
}) {
  const [eta, ...details] = [...(item.transfer ?? [])].reverse();
  const hasEta = !!eta && /left/i.test(eta);
  const facts = hasEta ? details.reverse() : (item.transfer ?? []);
  return (
    <div className="flex flex-col gap-vesper-3 p-vesper-3 rounded-vesper-1 border border-vesper-border-secondary">
      {title && (
        <Typography
          variant="label-xs-mono"
          className="text-vesper-text-secondary"
        >
          {title}
        </Typography>
      )}
      <div className="flex items-center justify-between gap-vesper-3">
        <Typography
          variant="label-sm-bold"
          className="text-vesper-text-primary"
        >
          {item.stageLabel ?? "Starting"}
        </Typography>
        <Typography
          variant="label-xs-mono"
          className="text-vesper-text-primary"
        >
          {item.progress === null ? "…" : `${item.progress}%`}
        </Typography>
      </div>
      <ProgressBar
        size="sm"
        value={item.progress ?? 0}
        animated
        aria-label="Progress"
      />
      {(facts.length > 0 || hasEta) && (
        <div className="flex items-center justify-between gap-vesper-3">
          <Typography
            variant="label-xs"
            className="text-vesper-text-secondary tabular-nums"
          >
            {facts.map((fact, i) => (
              <Fragment key={fact}>
                {i > 0 && <span aria-hidden> • </span>}
                {fact}
              </Fragment>
            ))}
          </Typography>
          {hasEta && (
            <Typography
              variant="label-xs"
              className="text-vesper-text-secondary"
            >
              {eta}
            </Typography>
          )}
        </div>
      )}
    </div>
  );
}

/** The red panel shown when a download or deployment fails. */
export function FailurePanel({
  item,
  onRetry,
  onDismiss,
}: {
  item: DeploymentItem;
  onRetry(): void;
  onDismiss(): void;
}) {
  const paused = !!useModelActionsPaused();
  return (
    <div className="flex flex-col gap-vesper-4 p-vesper-4 rounded-vesper-1 border border-vesper-border-error-subtle bg-vesper-background-error-subtle">
      <ProgressBar size="sm" value={0} aria-label="Progress" />
      {item.errorMessage && (
        <Typography
          variant="copy-xs"
          className="text-vesper-text-error break-words"
        >
          {item.errorMessage}
        </Typography>
      )}
      <div className="flex items-center gap-vesper-3">
        <Button
          type="button"
          size="xs"
          variant="contrast"
          iconLeft={<Reset />}
          disabled={paused}
          onClick={onRetry}
        >
          {item.state === "download-failed" ? "Retry" : "Redeploy"}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function DevicesPanel({
  deviceIds,
  pending = true,
}: {
  deviceIds: number[];
  /** Not placed yet, as opposed to placed on devices we don't know */
  pending?: boolean;
}) {
  return (
    <div className="flex flex-col gap-vesper-4 p-vesper-4 rounded-vesper-1 bg-vesper-tint-neutral-100">
      <Typography variant="label-sm-bold" className="text-vesper-text-primary">
        Devices
      </Typography>
      {deviceIds.length === 0 ? (
        <Typography variant="copy-xs" className="text-vesper-text-tertiary">
          {pending
            ? "Assigned automatically once the deployment starts."
            : "Unknown."}
        </Typography>
      ) : (
        <div className="flex flex-wrap gap-vesper-3">
          {deviceIds.map((id) => (
            <DeviceTag key={id} deviceId={id} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The demos (or playgrounds) an active deployment can be used in. */
export function AvailableDemos({
  title = "Available Demos",
  demos,
  onOpen,
}: {
  title?: string;
  demos: DemoLink[];
  onOpen(demo: DemoLink): void;
}) {
  if (demos.length === 0) return null;
  return (
    <section className="flex flex-col gap-vesper-4">
      <Typography
        as="h3"
        variant="copy-md"
        className="text-vesper-text-secondary"
      >
        {title}
      </Typography>
      <ul className="flex flex-col gap-vesper-4">
        {demos.map((demo, index) => {
          const Icon = getDemoIcon(demo.href);
          return (
            <li
              key={`${demo.href}:${index}`}
              className="flex items-center gap-vesper-3 p-vesper-4 rounded-vesper-2 border border-vesper-border-secondary bg-vesper-background-primary"
            >
              <Icon
                className="w-5 h-5 text-vesper-icon-secondary"
                aria-hidden
              />
              <Typography
                variant="label-lg"
                className="text-vesper-text-primary"
              >
                {demo.label}
              </Typography>
              <Button
                type="button"
                size="sm"
                className="ml-auto"
                onClick={() => onOpen(demo)}
              >
                Open
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DeploymentDetail({
  item,
  demos,
  onCancel,
  onRetry,
  onDismiss,
  onStop,
  onReset,
  onOpenLogs,
}: {
  item: DeploymentItem;
  demos: DemoLink[];
  onCancel(): void;
  onRetry(): void;
  onDismiss(): void;
  onStop(): void;
  onReset(): void;
  onOpenLogs(): void;
}) {
  const navigate = useNavigate();
  const inFlight = item.state === "downloading" || item.state === "deploying";
  const failed =
    item.state === "download-failed" || item.state === "deploy-failed";
  // a container's logs, a dead container's workflow log, or the deploy job's
  const canOpenLogs = !!item.containerId || !!item.historyId || !!item.jobId;
  // deploying and stopping are paused during a board reset or a Docker
  // control outage; cancelling a deploy that has a container stops it
  const paused = !!useModelActionsPaused();

  const openDemo = (demo: DemoLink) =>
    navigate(demo.href, {
      state: item.containerId
        ? { containerID: item.containerId, modelName: item.modelName }
        : undefined,
    });

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-vesper-8 py-vesper-10">
      <div
        className={cn(
          "flex flex-col gap-vesper-6 p-vesper-4 rounded-vesper-2 border bg-vesper-background-primary",
          CARD_BORDER[item.state]
        )}
      >
        <div className="flex flex-col gap-vesper-5">
          <DeploymentStatus state={item.state} />
          <div className="flex items-center gap-vesper-3">
            <ModelLogo
              hfModelId={item.hfModelId}
              modelName={item.modelName}
              className="w-6 h-6"
            />
            <Typography
              as="h2"
              variant="heading-sm"
              className="text-vesper-text-primary break-all"
            >
              {item.modelName}
            </Typography>
          </div>
        </div>

        {inFlight && <ProgressPanel item={item} />}
        {failed && (
          <FailurePanel item={item} onRetry={onRetry} onDismiss={onDismiss} />
        )}
        {item.state === "error" && item.errorMessage && (
          <Typography
            variant="copy-xs"
            className="text-vesper-text-error break-words"
          >
            {item.errorMessage}
          </Typography>
        )}

        <DevicesPanel deviceIds={item.deviceIds} pending={!item.containerId} />

        {item.state !== "active" && item.state !== "error" && (
          <Button
            type="button"
            size="md"
            variant="subtle"
            className="w-full"
            disabled
          >
            Open demo
          </Button>
        )}

        <div className="flex gap-vesper-3">
          <Button
            type="button"
            size="sm"
            variant="tertiary"
            className="flex-1"
            disabled={!item.containerId || item.state === "error"}
            onClick={() =>
              navigate(`/api-info/${encodeURIComponent(item.containerId!)}`)
            }
          >
            API
          </Button>
          <Button
            type="button"
            size="sm"
            variant="tertiary"
            className="flex-1"
            disabled={!canOpenLogs}
            onClick={onOpenLogs}
          >
            Logs
          </Button>
          {inFlight || failed ? (
            <Button
              type="button"
              size="sm"
              variant="tertiary"
              className="flex-1"
              iconLeft={<ErrorIcon />}
              disabled={!failed && paused && !!item.containerId}
              onClick={failed ? onDismiss : onCancel}
            >
              {failed ? "Dismiss" : "Cancel"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="tertiary"
              className="shrink-0 whitespace-nowrap"
              iconLeft={<ErrorIcon />}
              disabled={!item.containerId || item.dead || paused}
              onClick={onStop}
            >
              Stop container
            </Button>
          )}
        </div>

        {item.state === "error" && (
          <Button
            type="button"
            size="md"
            variant="danger"
            className="w-full"
            onClick={onReset}
          >
            Reset
          </Button>
        )}
      </div>

      {item.state === "active" && (
        <AvailableDemos demos={demos} onOpen={openDemo} />
      )}
    </div>
  );
}
