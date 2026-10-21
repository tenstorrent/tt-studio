// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Ellipses } from "@tenstorrent/vesper/icons";
import { Menu } from "@tenstorrent/vesper/menu";
import { StatusIndicator } from "@tenstorrent/vesper/status-indicator";
import { Typography } from "@tenstorrent/vesper/typography";

export function ActiveDeployments() {
  return (
    <aside className="w-68 border-r border-vesper-border-tertiary bg-vesper-background-primary flex flex-col max-h-full">
      <Typography
        as="div"
        variant="label-sm-mono"
        className="p-vesper-4 bg-vesper-tint-neutral-100 flex flex-col gap-4"
      >
        <span className="text-vesper-text-primary">Devices</span>
        <div className="flex gap-vesper-6 text-vesper-text-tertiary">
          <span>Used : 2</span>
          <span>Available : 2</span>
        </div>
      </Typography>
      <div className="p-vesper-6 flex flex-col gap-vesper-6 overflow-auto">
        <DeploymentCard />
        <DeploymentCard />
        <DeploymentCard />
        <DeploymentCard />
        <DeploymentCard />
        <DeploymentCard />
        <DeploymentCard />
        <DeploymentCard />
        <DeploymentCard />
        <DeploymentCard />
      </div>
    </aside>
  );
}

function DeploymentCard() {
  return (
    <div className="rounded-vesper-2 bg-vesper-background-secondary border border-vesper-border-tertiary">
      <div className="px-vesper-3 pt-vesper-3 flex items-center justify-between">
        <StatusIndicator state="queued" label="Downloading" animated />
        <Menu
          as={IconButton}
          size="xs"
          variant="ghost"
          icon={<Ellipses />}
          items={[]}
        />
      </div>
      <Typography
        variant="label-sm"
        className="px-vesper-3 py-vesper-6 text-vesper-text-primary"
      >
        Gemma-3-27b-it
      </Typography>
      <div className="px-vesper-3 pb-vesper-3">
        <StatusIndicator state="queued" label="Downloading" animated />
      </div>
    </div>
  );
}
