// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useMemo, useState } from "react";
import { parseAnsiColors } from "@/src/lib/ansi";

export const LOG_LEVELS = [
  "INFO",
  "DEBUG",
  "TRACE",
  "ERROR",
  "WARNING",
  "FATAL",
] as const;

/**
 * Which log levels are shown, a `LogViewer` filter for them, and how many of
 * the lines are errors. A line's level is the first level keyword in it.
 */
export function useLogLevelFilter(lines: string[]) {
  const [activeLevels, setActiveLevels] = useState<Set<string>>(
    () => new Set(LOG_LEVELS)
  );
  const allActive = activeLevels.size === LOG_LEVELS.length;

  const toggleLevel = useCallback(
    (level: string) =>
      setActiveLevels((prev) => {
        const next = new Set(prev);
        if (next.has(level)) next.delete(level);
        else next.add(level);
        return next;
      }),
    []
  );

  const filter = useCallback(
    (line: string) => {
      if (allActive) return true;
      const { level } = parseAnsiColors(line);
      if (!level) return false;
      const normalized =
        level.toUpperCase() === "WARN" ? "WARNING" : level.toUpperCase();
      return activeLevels.has(normalized);
    },
    [activeLevels, allActive]
  );

  const errorCount = useMemo(
    () =>
      lines.filter((line) => {
        const level = parseAnsiColors(line).level?.toUpperCase();
        return level === "ERROR" || level === "FATAL" || level === "CRITICAL";
      }).length,
    [lines]
  );

  return {
    activeLevels,
    toggleLevel,
    filter,
    errorCount,
    lineCount: lines.length,
  };
}
