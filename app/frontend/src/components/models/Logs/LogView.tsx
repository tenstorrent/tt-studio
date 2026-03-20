// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { ChevronDown } from "lucide-react";
import { parseAnsiColors, getLogLevelColor } from "../../../lib/ansi";

interface Props {
  logs: string[];
  filterLog: (line: string) => boolean;
  onScroll: () => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  showScrollButton: boolean;
  scrollToBottom: () => void;
}

export default function LogView({
  logs,
  filterLog,
  onScroll,
  scrollRef,
  showScrollButton,
  scrollToBottom,
}: Props) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="bg-gray-950 text-gray-300 p-4 rounded-lg font-mono text-sm overflow-auto h-full relative border border-gray-700 shadow-inner"
      style={{
        lineHeight: "1.6",
        scrollBehavior: "smooth",
        fontFamily: 'Consolas, "Courier New", "Monaco", monospace',
      }}
    >
      {logs.length === 0 ? (
        <div className="text-gray-500 italic">
          No logs available - waiting for container output...
        </div>
      ) : (
        logs.filter(filterLog).map((log, index) => {
          const parsed = parseAnsiColors(log);
          const isError =
            log.includes("ERROR") ||
            log.includes(" 500 ") ||
            log.includes("FATAL") ||
            log.includes("CRITICAL");
          const isWarning =
            log.includes("WARNING") || log.includes("WARN");
          return (
            <div
              key={index}
              className={`whitespace-pre-wrap py-0.5 px-1 rounded transition-colors duration-100 ${
                isError
                  ? "bg-red-950/30 text-red-400"
                  : isWarning
                    ? "bg-yellow-950/20 text-yellow-400"
                    : "hover:bg-gray-800/40"
              }`}
              style={{
                wordWrap: "break-word",
                overflowWrap: "break-word",
              }}
            >
              <span className="text-gray-600 text-xs mr-3 select-none inline-block w-8 text-right">
                {index + 1}
              </span>
              {parsed.level && (
                <span
                  className={`text-xs font-semibold mr-2 ${getLogLevelColor(parsed.level)}`}
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
            </div>
          );
        })
      )}
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-full shadow-lg transition-all duration-200 z-10"
          title="Scroll to bottom"
        >
          <ChevronDown className="w-6 h-6" />
        </button>
      )}
    </div>
  );
}
