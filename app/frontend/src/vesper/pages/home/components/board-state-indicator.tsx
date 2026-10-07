// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Link } from "@tenstorrent/vesper/icons";
import { cn } from "@/src/lib/utils";
import type { DeviceBoardState } from "../types";

export interface BoardStateIndicatorProps {
  state: DeviceBoardState;
  linked?: boolean;
}

export function BoardStateIndicator({ state, linked }: BoardStateIndicatorProps) {
  const bgClassName = cn(
    state === "busy" && "bg-vesper-background-accent-base",
    state === "deploying" && "bg-vesper-background-warning-base",
    state === "error" && "bg-vesper-background-error-base",
    state === "idle" && "bg-vesper-tint-neutral-400"
  );

  return (
    <div className="size-12 flex items-center justify-center border border-vesper-border-secondary rounded-vesper-1 bg-vesper-background-secondary">
      {linked ? (
        <div
          className={cn(
            "size-7.5 flex items-center justify-center rounded-vesper-half",
            bgClassName
          )}
        >
          <Link className="text-vesper-text-primary w-6 h-6" />
        </div>
      ) : (
        <div className="size-7.5 flex flex-wrap gap-vesper-half">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className={cn("size-3.5 rounded-vesper-half", bgClassName)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
