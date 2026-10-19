// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Tag } from "@tenstorrent/vesper/tag";
import { Chip } from "@tenstorrent/vesper/icons";
import { cn } from "@/src/lib/utils";
import { Typography } from "@tenstorrent/vesper/typography";
import { BoardCard } from "@/src/hooks/useBoardCards";
import { Device } from "./device";

export interface CardProps {
  card: BoardCard;
  label?: string;
}

export function Card({ card, label }: CardProps) {
  return (
    <div className="flex flex-col gap-vesper-2 w-full max-w-125 mx-auto">
      <div className="flex items-center gap-vesper-4">
        <Tag icon={<Chip />}>{card.cardModel}</Tag>
        {!!label && (
          <Typography
            variant="label-sm-mono"
            className="text-vesper-text-secondary"
          >
            {label}
          </Typography>
        )}
      </div>
      <div
        className={cn(
          "p-vesper-4 rounded-vesper-4 bg-vesper-tint-neutral-100 border border-vesper-border-secondary relative",
          "grid gap-vesper-6 grid-cols-1",
          card.devices.length > 1 && "sm:grid-cols-2"
        )}
      >
        {card.devices.length > 1 && <Connector />}
        {card.devices.map((device, index) => (
          <Device key={index} device={device} index={index} />
        ))}
      </div>
    </div>
  );
}

function Connector() {
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <div className="relative flex items-center w-[calc(var(--vesper-spacing-6)+1px)] h-0 sm:rotate-0 rotate-90">
        <ConnectorNode className="-left-1.5" />
        <div className="h-px w-full bg-vesper-border-accent-base" />
        <ConnectorNode className="-right-1.5" />
      </div>
    </div>
  );
}

function ConnectorNode({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "absolute size-3 rounded-full border border-vesper-border-accent-base bg-vesper-background-primary",
        className
      )}
    />
  );
}
