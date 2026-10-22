// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { ArrowDown } from "@tenstorrent/vesper/icons";
import { Typography } from "@tenstorrent/vesper/typography";
import { parseAnsiColors } from "@/src/lib/ansi";
import { cn } from "@/src/lib/utils";

const ERROR_PATTERN = /ERROR|FATAL|CRITICAL| 500 /;
const WARNING_PATTERN = /WARNING|WARN\b/;

function levelClassName(level?: string) {
  switch (level?.toUpperCase()) {
    case "ERROR":
    case "FATAL":
    case "CRITICAL":
      return "text-vesper-text-error";
    case "WARN":
    case "WARNING":
      return "text-vesper-text-warning";
    case "DEBUG":
    case "TRACE":
      return "text-vesper-text-tertiary";
    default:
      return "text-vesper-text-info";
  }
}

/**
 * A scrolling list of log lines with line numbers and log level highlighting.
 * Sticks to the bottom as lines stream in, until the user scrolls up.
 */
export function LogViewer({
  lines,
  filter,
  emptyState,
  className,
}: {
  lines: string[];
  /** Return `false` to hide a line; line numbers keep counting hidden lines */
  filter?: (line: string) => boolean;
  emptyState?: ReactNode;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // whether to follow new output; a ref so scroll events and renders agree
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // stay pinned while the viewer itself changes size (e.g. a modal opening)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    stickRef.current = atBottom;
    setShowJump(!atBottom);
  }, []);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className={cn("relative min-h-0 flex flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-auto rounded-vesper-2 border border-vesper-border-tertiary bg-vesper-background-secondary py-vesper-2"
      >
        {lines.length === 0 ? (
          <div className="px-vesper-4 py-vesper-6">
            {emptyState ?? (
              <Typography
                variant="label-sm-mono"
                className="text-vesper-text-tertiary animate-pulse"
              >
                Waiting for output…
              </Typography>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse font-vesper-mono text-xs leading-vesper-relaxed">
            <tbody>
              {lines.map((line, index) => {
                if (filter && !filter(line)) return null;
                const parsed = parseAnsiColors(line);
                const isError = ERROR_PATTERN.test(line);
                const isWarning = !isError && WARNING_PATTERN.test(line);
                return (
                  <tr
                    key={index}
                    className={cn(
                      "border-l-2",
                      isError
                        ? "border-l-vesper-border-error-base bg-vesper-background-error-subtle"
                        : isWarning
                          ? "border-l-vesper-border-warning-base bg-vesper-background-warning-subtle"
                          : "border-l-transparent"
                    )}
                  >
                    <td className="select-none align-top text-right pl-vesper-3 pr-vesper-3 text-vesper-text-tertiary tabular-nums border-r border-vesper-border-tertiary w-12">
                      {index + 1}
                    </td>
                    <td
                      className={cn(
                        "align-top px-vesper-3 whitespace-pre-wrap break-all",
                        isError
                          ? "text-vesper-text-error"
                          : isWarning
                            ? "text-vesper-text-warning"
                            : "text-vesper-text-secondary"
                      )}
                    >
                      {parsed.level && (
                        <span
                          className={cn(
                            "mr-vesper-2",
                            levelClassName(parsed.level)
                          )}
                        >
                          {parsed.level}
                        </span>
                      )}
                      {parsed.segments.map((segment, i) => (
                        <span
                          key={i}
                          className={cn(
                            segment.bold && "font-medium",
                            segment.italic && "italic"
                          )}
                        >
                          {segment.text}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {showJump && lines.length > 0 && (
        <IconButton
          type="button"
          size="sm"
          variant="subtle"
          aria-label="Scroll to the latest output"
          icon={<ArrowDown />}
          onClick={scrollToBottom}
          className="absolute bottom-vesper-3 right-vesper-5"
        />
      )}
    </div>
  );
}
