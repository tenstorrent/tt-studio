// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ReactNode } from "react";
import { Tag, type TagVariant } from "@tenstorrent/vesper/tag";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";

/** A tag below a catalog card's name, optionally explained on hover. */
export interface CatalogCardTag {
  label: string;
  variant?: TagVariant;
  tooltip?: string;
}

/**
 * The selectable card used in the model and solution catalogs. Disabled cards
 * explain why in a tooltip.
 */
export function CatalogCard({
  task,
  tags,
  devices,
  icon,
  name,
  description,
  disabled,
  disabledReason,
  status,
  onSelect,
}: {
  task?: string;
  /** Extra tags rendered below the name and description */
  tags?: (string | CatalogCardTag)[];
  devices: number;
  icon: ReactNode;
  name: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string | null;
  /** Shown in place of the device count, e.g. while the model is deploying */
  status?: string;
  onSelect(): void;
}) {
  const card = (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      aria-disabled={disabled || undefined}
      className={cn(
        "w-full h-full flex flex-col gap-vesper-5 p-vesper-4 text-left rounded-vesper-2 border",
        "border-vesper-border-tertiary bg-vesper-tint-neutral-100 transition-colors duration-vesper-fast",
        "focus-visible:outline-none focus-visible:shadow-vesper-focus-ring",
        disabled
          ? "cursor-not-allowed opacity-40"
          : "hover:bg-vesper-tint-neutral-200 hover:border-vesper-border-secondary cursor-pointer"
      )}
    >
      <div className="w-full flex items-center justify-between gap-vesper-4">
        {!!task && <Tag size="sm">{task}</Tag>}
        <Tag size="sm" variant="accent-subtle">
          {status ?? `${devices} ${devices === 1 ? "device" : "devices"}`}
        </Tag>
      </div>
      <div className="flex flex-col gap-vesper-2 min-w-0">
        <div className="flex items-center gap-vesper-2 min-w-0">
          {icon}
          <Typography
            as="span"
            variant="label-md-mono"
            className="text-vesper-text-primary"
          >
            {name}
          </Typography>
        </div>
        {!!description && (
          <Typography
            variant="copy-xs"
            className="line-clamp-2 text-vesper-text-tertiary"
          >
            {description}
          </Typography>
        )}
      </div>
      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-vesper-2">
          {tags.map((entry) => {
            const tag = typeof entry === "string" ? { label: entry } : entry;
            const element = (
              <Tag key={tag.label} size="sm" variant={tag.variant}>
                {tag.label}
              </Tag>
            );
            return tag.tooltip ? (
              <Tooltip key={tag.label} content={tag.tooltip} maxWidth={280}>
                {element}
              </Tooltip>
            ) : (
              element
            );
          })}
        </div>
      )}
    </button>
  );

  if (disabled && disabledReason) {
    return (
      <Tooltip content={disabledReason} side="bottom">
        {card}
      </Tooltip>
    );
  }
  return card;
}
