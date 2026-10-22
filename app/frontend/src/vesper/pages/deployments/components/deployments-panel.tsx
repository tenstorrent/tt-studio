// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { MenuItemProps } from "@tenstorrent/vesper/menu";
import { Typography } from "@tenstorrent/vesper/typography";
import type { ChipStatus } from "@/src/types/chipStatus";
import type { DeploymentItem } from "@/src/vesper/types";
import { DeploymentCard } from "./deployment-card";

export function DeploymentsPanel({
  items,
  chipStatus,
  selectedKey,
  menuItemsFor,
  onSelect,
  onCancel,
  onRetry,
  onDismiss,
  onRemoveAndRedeploy,
}: {
  items: DeploymentItem[];
  chipStatus: ChipStatus | null;
  selectedKey: string | null;
  menuItemsFor(item: DeploymentItem): MenuItemProps[];
  onSelect(item: DeploymentItem): void;
  onCancel(item: DeploymentItem): void;
  onRetry(item: DeploymentItem): void;
  onDismiss(item: DeploymentItem): void;
  onRemoveAndRedeploy(item: DeploymentItem): void;
}) {
  const total = chipStatus?.total_slots ?? null;
  const used = chipStatus
    ? chipStatus.slots.filter((s) => s.status === "occupied").length
    : null;

  return (
    <aside
      aria-label="Deployments"
      className="w-80 shrink-0 h-full flex flex-col text-left border-r border-vesper-border-tertiary bg-vesper-background-primary"
    >
      <div className="flex flex-col gap-vesper-3 px-vesper-4 py-vesper-5 bg-vesper-background-secondary">
        <Typography
          as="h2"
          variant="label-sm-mono"
          className="font-normal text-vesper-text-primary"
        >
          Devices
        </Typography>
        <Typography
          variant="label-xs-mono"
          className="flex gap-vesper-8 text-vesper-text-tertiary"
        >
          <span>Used : {used ?? "-"}</span>
          <span>
            Available : {total !== null && used !== null ? total - used : "-"}
          </span>
        </Typography>
      </div>
      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-vesper-6">
          <Typography
            variant="label-md-mono"
            className="text-vesper-text-secondary"
          >
            No models deployed
          </Typography>
        </div>
      ) : (
        <ul className="flex-1 overflow-auto flex flex-col gap-vesper-6 p-vesper-6">
          {items.map((item) => (
            <li key={item.key}>
              <DeploymentCard
                item={item}
                selected={item.key === selectedKey}
                menuItems={menuItemsFor(item)}
                onSelect={() => onSelect(item)}
                onCancel={() => onCancel(item)}
                onRetry={() => onRetry(item)}
                onDismiss={() => onDismiss(item)}
                onRemoveAndRedeploy={() => onRemoveAndRedeploy(item)}
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
