// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Chip } from "@tenstorrent/vesper/chip";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { CircleXSolid } from "@tenstorrent/vesper/icons";
// vesper has no sliders icon yet, so borrow lucide's
import { SlidersHorizontal } from "lucide-react";
import { TextButton } from "@tenstorrent/vesper/text-button";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import type { Verification } from "@/src/vesper/utils/models";
import {
  countActiveFilters,
  DEFAULT_FILTERS,
  type CatalogFilters as Filters,
} from "../utils";

const VERIFICATION_OPTIONS: { value: Verification; label: string }[] = [
  { value: "verified", label: "TT-Verified" },
  { value: "unverified", label: "Unverified" },
];

function toggle<T>(list: T[], value: T) {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

function FilterChip({
  selected,
  onChange,
  children,
}: {
  selected: boolean;
  onChange(): void;
  children: string;
}) {
  return (
    <Chip
      type="button"
      size="sm"
      variant={selected ? "contrast" : "default"}
      selected={selected}
      iconRight={selected ? <CircleXSolid /> : undefined}
      onChange={onChange}
    >
      {children}
    </Chip>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-vesper-3">
      <Typography
        as="legend"
        variant="label-sm-mono"
        className="mb-vesper-3 text-vesper-text-secondary"
      >
        {title}
      </Typography>
      {children}
    </fieldset>
  );
}

/** The filter button and its dropdown panel for the model catalog. */
export function CatalogFiltersButton({
  filters,
  onChange,
  tasks,
}: {
  filters: Filters;
  onChange(filters: Filters): void;
  /** Task names available in the catalog */
  tasks: string[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeCount = countActiveFilters(filters);

  // close on outside click and escape
  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <IconButton
        type="button"
        variant="subtle"
        icon={<SlidersHorizontal strokeWidth={1.5} />}
        aria-label={activeCount ? `Filters (${activeCount} active)` : "Filters"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
      />
      {activeCount > 0 && (
        <span className="pointer-events-none absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-vesper-background-accent-base text-[10px] leading-4 text-center font-vesper-mono text-vesper-text-primary">
          {activeCount}
        </span>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Filter models"
          className={cn(
            "absolute right-0 top-full mt-vesper-3 z-20 w-80 flex flex-col gap-vesper-10 p-vesper-4 text-left",
            "rounded-vesper-2 border border-vesper-border-secondary bg-vesper-background-secondary shadow-vesper-300"
          )}
        >
          <Section title="Verification">
            <div className="flex flex-wrap gap-vesper-2">
              {VERIFICATION_OPTIONS.map((option) => (
                <FilterChip
                  key={option.value}
                  selected={filters.verification.includes(option.value)}
                  onChange={() =>
                    onChange({
                      ...filters,
                      verification: toggle(filters.verification, option.value),
                    })
                  }
                >
                  {option.label}
                </FilterChip>
              ))}
            </div>
          </Section>
          <Section title="Task">
            <div className="flex flex-wrap gap-vesper-2">
              {tasks.map((task) => (
                <FilterChip
                  key={task}
                  selected={filters.tasks.includes(task)}
                  onChange={() =>
                    onChange({ ...filters, tasks: toggle(filters.tasks, task) })
                  }
                >
                  {task}
                </FilterChip>
              ))}
            </div>
          </Section>
          {activeCount > 0 && (
            <TextButton
              type="button"
              size="sm"
              variant="subtle"
              className="self-end -mt-vesper-4"
              onClick={() => onChange(DEFAULT_FILTERS)}
            >
              Clear filters
            </TextButton>
          )}
        </div>
      )}
    </div>
  );
}
