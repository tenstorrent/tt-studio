// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { parseAnsiColors } from "../../../lib/ansi";

interface Props {
  events: string[];
  onScroll: () => void;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export default function EventsView({ events, onScroll, scrollRef }: Props) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="bg-gray-950 text-blue-400 p-4 rounded-lg font-mono text-sm overflow-auto h-full relative border border-gray-700 shadow-inner"
      style={{
        lineHeight: "1.5",
        scrollBehavior: "smooth",
        fontFamily:
          'Consolas, "Monaco", "Lucida Console", "Liberation Mono", "DejaVu Sans Mono", "Bitstream Vera Sans Mono", "Courier New", monospace',
      }}
    >
      {events.length === 0 ? (
        <div className="text-gray-500 italic">
          No events available - container events will appear here...
        </div>
      ) : (
        events.map((event, index) => {
          const parsed = parseAnsiColors(event);
          const isError =
            parsed.level &&
            ["ERROR", "FATAL", "CRITICAL"].includes(parsed.level);
          const isWarning =
            parsed.level && ["WARN", "WARNING"].includes(parsed.level);
          const isInfo = parsed.level && ["INFO"].includes(parsed.level);
          const isStartupEvent =
            event.includes("startup complete") ||
            event.includes("Uvicorn running") ||
            event.includes("Started server process");
          return (
            <div
              key={index}
              className={`whitespace-pre-wrap leading-relaxed py-1 px-2 rounded hover:bg-gray-900 hover:bg-opacity-50 transition-colors duration-150 group mb-1 border-l-4 ${
                isError
                  ? "border-red-500 bg-red-900 bg-opacity-20"
                  : isWarning
                    ? "border-yellow-500 bg-yellow-900 bg-opacity-20"
                    : isInfo || isStartupEvent
                      ? "border-green-500 bg-green-900 bg-opacity-20"
                      : "border-blue-500 bg-blue-900 bg-opacity-20"
              }`}
              style={{
                wordWrap: "break-word",
                overflowWrap: "break-word",
                fontFamily: 'Consolas, "Courier New", "Monaco", monospace',
              }}
            >
              <div className="flex items-start gap-2">
                <span className="text-gray-500 text-xs mr-1 select-none flex-shrink-0">
                  {String(index + 1).padStart(3, "0")}
                </span>
                <div className="flex-1">
                  {parsed.level && (
                    <span
                      className={`text-xs font-bold mr-2 px-1 py-0.5 rounded ${
                        isError
                          ? "bg-red-500 text-white"
                          : isWarning
                            ? "bg-yellow-500 text-black"
                            : isInfo || isStartupEvent
                              ? "bg-green-500 text-white"
                              : "bg-blue-500 text-white"
                      }`}
                    >
                      {parsed.level}
                    </span>
                  )}
                  <span className="terminal-content">
                    {parsed.segments.map((segment, segIndex) => (
                      <span
                        key={segIndex}
                        style={{
                          color:
                            segment.color ||
                            (isError
                              ? "#FF6B6B"
                              : isWarning
                                ? "#FFD93D"
                                : isInfo || isStartupEvent
                                  ? "#50FA7B"
                                  : "#8BE9FD"),
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
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

