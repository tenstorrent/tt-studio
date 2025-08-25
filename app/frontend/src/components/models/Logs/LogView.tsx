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
      className="bg-gray-950 text-green-400 p-4 rounded-lg font-mono text-sm overflow-auto h-full relative border border-gray-700 shadow-inner"
      style={{
        lineHeight: "1.5",
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
          return (
            <div
              key={index}
              className={`whitespace-pre-wrap leading-relaxed py-0.5 hover:bg-gray-900 hover:bg-opacity-30 transition-colors duration-150 group ${
                log.includes("ERROR") || log.includes(" 500 ")
                  ? "text-red-400"
                  : ""
              }`}
              style={{
                wordWrap: "break-word",
                overflowWrap: "break-word",
                fontFamily: 'Consolas, "Courier New", "Monaco", monospace',
              }}
            >
              <span className="text-gray-500 text-xs mr-2 select-none">
                {String(index + 1).padStart(3, "0")}
              </span>
              {parsed.level && (
                <span
                  className={`text-xs font-bold mr-2 ${getLogLevelColor(parsed.level)}`}
                >
                  [{parsed.level}]
                </span>
              )}
              <span className="terminal-content">
                {parsed.segments.map((segment, segIndex) => (
                  <span
                    key={segIndex}
                    style={{
                      color:
                        segment.color || (parsed.level ? undefined : "#50FA7B"),
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
      {logs.length > 0 && (
        <div className="flex items-center mt-2 opacity-75">
          <span className="text-gray-500 text-xs mr-2 select-none">$</span>
          <span className="text-green-400 animate-pulse text-sm">█</span>
        </div>
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

