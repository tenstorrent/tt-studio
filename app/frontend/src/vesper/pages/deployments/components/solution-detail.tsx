// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useNavigate } from "react-router-dom";
import { Button } from "@tenstorrent/vesper/button";
import { AIAgent, Error as ErrorIcon } from "@tenstorrent/vesper/icons";
import { Menu } from "@tenstorrent/vesper/menu";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import type { DemoLink, DeploymentItem } from "@/src/vesper/types";
import {
  getDemosForModelType,
  VOICE_AGENT_DEMO,
} from "@/src/vesper/utils/models";
import { STATE_LABEL } from "../constants";
import { DeploymentStatus } from "./deployment-card";
import {
  AvailableDemos,
  DevicesPanel,
  ProgressPanel,
} from "./deployment-detail";

/** The combined detail view of a solution's deployments. */
export function SolutionDetail({
  item,
  onCancel,
  onStop,
  onOpenLogs,
}: {
  item: DeploymentItem;
  onCancel(): void;
  onStop(): void;
  onOpenLogs(member: DeploymentItem): void;
}) {
  const navigate = useNavigate();
  const members = item.members ?? [];
  const allActive =
    members.length > 0 && members.every((m) => m.state === "active");
  const inFlight = members.some(
    (m) => m.state === "downloading" || m.state === "deploying"
  );
  const withContainers = members.filter((m) => m.containerId);

  const demos: (DemoLink & { member?: DeploymentItem })[] = [
    VOICE_AGENT_DEMO,
    ...members.flatMap((member) =>
      getDemosForModelType(member.modelType).map((demo) => ({
        ...demo,
        member,
      }))
    ),
  ];

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-vesper-8 py-vesper-10">
      <div
        className={cn(
          "flex flex-col gap-vesper-6 p-vesper-4 rounded-vesper-2 border bg-vesper-background-primary",
          item.state === "downloading" && "border-vesper-border-accent-base",
          item.state === "deploying" && "border-vesper-border-warning-base",
          item.state === "active" && "border-vesper-border-secondary",
          (item.state === "error" ||
            item.state === "download-failed" ||
            item.state === "deploy-failed") &&
            "border-vesper-border-error-base"
        )}
      >
        <div className="flex flex-col gap-vesper-5">
          <DeploymentStatus state={item.state} />
          <div className="flex items-center gap-vesper-3">
            <AIAgent className="w-6 h-6 text-vesper-icon-primary" aria-hidden />
            <Typography
              as="h2"
              variant="heading-sm"
              className="text-vesper-text-primary"
            >
              {item.modelName}
            </Typography>
          </div>
        </div>

        <div className="flex flex-col gap-vesper-3">
          {members.map((member) =>
            member.state === "downloading" || member.state === "deploying" ? (
              <ProgressPanel
                key={member.key}
                title={member.modelName}
                item={member}
              />
            ) : (
              <div
                key={member.key}
                className="flex flex-col gap-vesper-2 p-vesper-3 rounded-vesper-1 border border-vesper-border-secondary"
              >
                <div className="flex items-center justify-between gap-vesper-3">
                  <Typography
                    variant="label-xs-mono"
                    className="text-vesper-text-secondary"
                  >
                    {member.modelName}
                  </Typography>
                  <StatusIndicator
                    state={member.state === "active" ? "ready" : "error"}
                    label={STATE_LABEL[member.state]}
                  />
                </div>
                {member.errorMessage && member.state !== "active" && (
                  <Typography
                    variant="copy-xs"
                    className="text-vesper-text-error break-words"
                  >
                    {member.errorMessage}
                  </Typography>
                )}
              </div>
            )
          )}
        </div>

        <DevicesPanel deviceIds={item.deviceIds} />

        {!allActive && (
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
          <Menu
            as={Button}
            type="button"
            size="sm"
            variant="tertiary"
            className="flex-1"
            disabled={withContainers.length === 0}
            items={withContainers.map((member) => ({
              text: member.modelName,
              onSelect: () =>
                navigate(
                  `/api-info/${encodeURIComponent(member.containerId!)}`
                ),
            }))}
          >
            API
          </Menu>
          <Menu
            as={Button}
            type="button"
            size="sm"
            variant="tertiary"
            className="flex-1"
            disabled={!members.some((m) => m.containerId || m.historyId || m.jobId)}
            items={members
              .filter((m) => m.containerId || m.historyId || m.jobId)
              .map((member) => ({
                text: member.modelName,
                onSelect: () => onOpenLogs(member),
              }))}
          >
            Logs
          </Menu>
          {inFlight ? (
            <Button
              type="button"
              size="sm"
              variant="tertiary"
              className="flex-1"
              iconLeft={<ErrorIcon />}
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="tertiary"
              className="shrink-0 whitespace-nowrap"
              iconLeft={<ErrorIcon />}
              disabled={withContainers.length === 0}
              onClick={onStop}
            >
              Stop all
            </Button>
          )}
        </div>
      </div>

      {allActive && (
        <AvailableDemos
          title="Available Playgrounds"
          demos={demos}
          onOpen={(demo) => {
            const member = (demo as { member?: DeploymentItem }).member;
            navigate(demo.href, {
              state: member?.containerId
                ? {
                    containerID: member.containerId,
                    modelName: member.modelName,
                  }
                : undefined,
            });
          }}
        />
      )}
    </div>
  );
}
