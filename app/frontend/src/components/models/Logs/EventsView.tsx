// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { ChevronDown } from "lucide-react";
import { parseAnsiColors } from "../../../lib/ansi";

interface Props {
  events: string[];
  filterLog: (line: string) => boolean;
  onScroll: () => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  showScrollButton: boolean;
  scrollToBottom: () => void;
}

const levelStyle = (level: string | undefined, isStartup: boolean) => {
  if (!level && !isStartup) return { badge: "bg-gray-700 text-gray-300", row: "", text: undefined };
  switch (level) {
    case "ERROR":
    case "FATAL":
    case "CRITICAL":
      return { badge: "bg-red-900/60 text-red-400", row: "border-l-2 border-red-500/60 bg-red-950/20", text: "#f87171" };
    case "WARN":
    case "WARNING":
      return { badge: "bg-yellow-900/60 text-yellow-400", row: "border-l-2 border-yellow-500/60 bg-yellow-950/15", text: "#facc15" };
    case "INFO":
      return { badge: "bg-blue-900/60 text-blue-400", row: isStartup ? "border-l-2 border-green-500/60 bg-green-950/15" : "border-l-2 border-blue-500/40", text: undefined };
    case "DEBUG":
    case "TRACE":
      return { badge: "bg-gray-800 text-gray-400", row: "border-l-2 border-gray-700/40", text: undefined };
    default:
      if (isStartup) return { badge: "bg-green-900/60 text-green-400", row: "border-l-2 border-green-500/60 bg-green-950/15", text: undefined };
      return { badge: "bg-gray-700 text-gray-300", row: "border-l-2 border-gray-700/40", text: undefined };
  }
};

export default function EventsView({
  events,
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
      {events.length === 0 ? (
        <div className="text-gray-500 italic">
          No events available - container events will appear here...
        </div>
      ) : (
        events.filter(filterLog).map((event, index) => {
          const parsed = parseAnsiColors(event);
          const isStartupEvent =
            event.includes("startup complete") ||
            event.includes("Uvicorn running") ||
            event.includes("Started server process");
          const style = levelStyle(parsed.level, isStartupEvent);

          return (
            <div
              key={index}
              className={`whitespace-pre-wrap py-1 px-2 rounded mb-0.5 transition-colors duration-100 hover:bg-gray-800/40 ${style.row}`}
              style={{
                wordWrap: "break-word",
                overflowWrap: "break-word",
              }}
            >
              <span className="text-gray-600 text-xs mr-3 select-none inline-block w-8 text-right">
                {index + 1}
              </span>
              {(parsed.level || isStartupEvent) && (
                <span
                  className={`text-xs font-semibold mr-2 px-1.5 py-0.5 rounded ${style.badge}`}
                >
                  {parsed.level || "STARTUP"}
                </span>
              )}
              <span>
                {parsed.segments.map((segment, segIndex) => (
                  <span
                    key={segIndex}
                    style={{
                      color: segment.color || style.text || undefined,
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
