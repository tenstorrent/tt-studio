// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Fragment } from "react";
import { Chip as ChipIcon } from "@tenstorrent/vesper/icons";
import { Tag } from "@tenstorrent/vesper/tag";
import { Typography } from "@tenstorrent/vesper/typography";
import type {
  HardwareCard,
  HardwareDevice,
} from "@/src/vesper/hooks/use-hardware";
import { DeviceCard } from "./device-card";

/** Two neighbouring devices are linked when one deployment spans both. */
function isLinked(a?: HardwareDevice, b?: HardwareDevice) {
  return (
    !!a?.deployment && !!b?.deployment && a.deployment.key === b.deployment.key
  );
}

/** The connector drawn between two linked devices. */
function LinkConnector({ visible }: { visible: boolean }) {
  return (
    <div className="relative w-6 h-3 shrink-0 self-center" aria-hidden>
      {visible && (
        <>
          <span className="absolute left-0 right-0 top-1/2 border-t border-vesper-border-accent-base" />
          <span className="absolute left-0 top-0 -translate-x-1/2 w-3 h-3 rounded-full border border-vesper-border-accent-base bg-vesper-background-primary" />
          <span className="absolute right-0 top-0 translate-x-1/2 w-3 h-3 rounded-full border border-vesper-border-accent-base bg-vesper-background-primary" />
        </>
      )}
    </div>
  );
}

export function CardGroup({
  card,
  onReset,
  onViewLogs,
}: {
  card: HardwareCard;
  onReset(device: HardwareDevice): void;
  onViewLogs(device: HardwareDevice): void;
}) {
  return (
    <section
      className="flex flex-col gap-vesper-2"
      aria-label={`Card ${card.index + 1}`}
    >
      <div className="flex items-center gap-vesper-4">
        <Tag size="sm" icon={<ChipIcon />}>
          {card.boardType}
        </Tag>
        <Typography
          as="h2"
          variant="label-sm-mono"
          className="font-normal text-vesper-text-secondary"
        >
          Card {String(card.index + 1).padStart(2, "0")}
        </Typography>
      </div>
      <div className="flex p-vesper-4 rounded-vesper-4 border border-vesper-border-primary bg-vesper-background-primary">
        {card.devices.map((device, i) => {
          const prev = card.devices[i - 1];
          const next = card.devices[i + 1];
          return (
            <Fragment key={device.index}>
              {i > 0 && <LinkConnector visible={isLinked(prev, device)} />}
              <DeviceCard
                device={device}
                linked={isLinked(prev, device) || isLinked(device, next)}
                onReset={onReset}
                onViewLogs={onViewLogs}
              />
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
