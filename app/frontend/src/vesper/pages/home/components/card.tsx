// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Tag } from "@tenstorrent/vesper/tag";
import { Chip } from "@tenstorrent/vesper/icons";
import { cn } from "@/src/lib/utils";
import { DeviceBoardData } from "../types";
import { Board } from "./board";

export interface CardProps {
  paired: boolean;
  name: string;
  boards: DeviceBoardData[];
}

export function Card({ paired, name, boards }: CardProps) {
  const linked = paired && boards.every((b) => b.state !== "idle");

  return (
    <div className="flex flex-col gap-vesper-2 w-full">
      <Tag icon={<Chip />}>{name}</Tag>
      <div className="p-vesper-4 flex sm:flex-row flex-col gap-vesper-6 rounded-vesper-4 bg-vesper-tint-neutral-100 border border-vesper-border-secondary relative">
        {boards.map((board, index) => (
          <Board key={index} linked={linked} {...board} />
        ))}
        {linked && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative flex items-center w-[calc(var(--vesper-spacing-6)+1px)] h-0 sm:rotate-0 rotate-90">
              <ConnectorNode className="-left-1.5" />
              <div className="h-px w-full bg-vesper-border-accent-base" />
              <ConnectorNode className="-right-1.5" />
            </div>
          </div>
        )}
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
