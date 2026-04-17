// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from "react";
import { parseAnsiColors, getLogLevelColor } from "../../../lib/ansi";

interface Props {
  logs: string[];
  filterLog: (line: string) => boolean;
  onScroll: () => void;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export default function LogView({
  logs,
  filterLog,
  onScroll,
  scrollRef,
}: Props) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="overflow-auto h-full relative text-sm"
      style={{
        background: "#07080a",
        border: "1px solid #141618",
        borderRadius: "8px",
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
        fontSize: "12.5px",
        lineHeight: "1.7",
        scrollBehavior: "smooth",
      }}
    >
      {logs.length === 0 ? (
        <div
          className="px-6 py-8 font-mono text-xs"
          style={{ color: "#2d3039" }}
        >
          <span style={{ color: "#1f2937" }}>$</span>{" "}
          <span className="animate-pulse">waiting for output…</span>
        </div>
      ) : (
        <table className="w-full border-collapse">
          <tbody>
            {logs.map((log, originalIndex) => {
              if (!filterLog(log)) return null;
              const parsed = parseAnsiColors(log);
              const isError =
                log.includes("ERROR") ||
                log.includes(" 500 ") ||
                log.includes("FATAL") ||
                log.includes("CRITICAL");
              const isWarning = log.includes("WARNING") || log.includes("WARN");

              return (
                <tr
                  key={originalIndex}
                  data-log-index={originalIndex}
                  className="group"
                  style={{
                    borderLeft: isError
                      ? "2px solid #7f1d1d"
                      : isWarning
                        ? "2px solid #78350f"
                        : "2px solid transparent",
                    background: isError
                      ? "rgba(127,29,29,0.12)"
                      : isWarning
                        ? "rgba(120,53,15,0.08)"
                        : "transparent",
                  }}
                >
                  {/* Line number */}
                  <td
                    className="select-none text-right align-top pr-3 pl-3"
                    style={{
                      color: "#2d3039",
                      fontSize: "11px",
                      minWidth: "3rem",
                      paddingTop: "1px",
                      paddingBottom: "1px",
                      borderRight: "1px solid #141618",
                      verticalAlign: "top",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {originalIndex + 1}
                  </td>

                  {/* Log content */}
                  <td
                    className="pl-4 pr-4 align-top"
                    style={{
                      paddingTop: "1px",
                      paddingBottom: "1px",
                      wordBreak: "break-all",
                      overflowWrap: "anywhere",
                      whiteSpace: "pre-wrap",
                      color: isError ? "#fca5a5" : isWarning ? "#fcd34d" : "#9ca3af",
                    }}
                  >
                    {parsed.level && (
                      <span
                        className={`text-xs font-bold mr-2 ${getLogLevelColor(parsed.level)}`}
                        style={{ letterSpacing: "0.04em" }}
                      >
                        {parsed.level}
                      </span>
                    )}
                    <span>
                      {parsed.segments.map((segment, segIndex) => (
                        <span
                          key={segIndex}
                          style={{
                            color: segment.color || undefined,
                            backgroundColor: segment.backgroundColor,
                            fontWeight: segment.bold ? "bold" : "normal",
                            fontStyle: segment.italic ? "italic" : "normal",
                          }}
                        >
                          {segment.text}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
