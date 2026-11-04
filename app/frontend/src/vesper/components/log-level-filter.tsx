// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ReactNode } from "react";
import { Chip } from "@tenstorrent/vesper/chip";
import { Typography } from "@tenstorrent/vesper/typography";
import {
  LOG_LEVELS,
  type useLogLevelFilter,
} from "@/src/vesper/hooks/use-log-level-filter";

/** The level chips above a log, with error and line counts and a status slot. */
export function LogLevelFilter({
  activeLevels,
  toggleLevel,
  errorCount,
  lineCount,
  status,
}: Omit<ReturnType<typeof useLogLevelFilter>, "filter"> & {
  /** Shown at the end of the bar, e.g. whether the log is live */
  status?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-vesper-2">
      <Typography
        variant="label-xs-mono"
        className="uppercase text-vesper-text-tertiary mr-vesper-2"
      >
        Filter
      </Typography>
      {LOG_LEVELS.map((level) => (
        <Chip
          key={level}
          type="button"
          size="sm"
          selected={activeLevels.has(level)}
          onChange={() => toggleLevel(level)}
        >
          {level}
        </Chip>
      ))}
      <div className="ml-auto flex items-center gap-vesper-4">
        {errorCount > 0 && (
          <Typography variant="label-sm" className="text-vesper-text-error">
            {errorCount} {errorCount === 1 ? "error" : "errors"}
          </Typography>
        )}
        <Typography
          variant="label-sm-mono"
          className="text-vesper-text-tertiary"
        >
          {lineCount} lines
        </Typography>
        {status}
      </div>
    </div>
  );
}
