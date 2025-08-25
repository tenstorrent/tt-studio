// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";

interface Props {
  metrics: Record<string, number>;
  onScroll: () => void;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export default function MetricsView({ metrics, onScroll, scrollRef }: Props) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="bg-gray-950 text-yellow-400 p-4 rounded-lg font-mono text-sm overflow-auto h-full relative border border-gray-700 shadow-inner"
      style={{
        lineHeight: "1.5",
        scrollBehavior: "smooth",
        fontFamily:
          'Consolas, "Monaco", "Lucida Console", "Liberation Mono", "DejaVu Sans Mono", "Bitstream Vera Sans Mono", "Courier New", monospace',
      }}
    >
      {Object.keys(metrics).length === 0 ? (
        <div className="text-gray-500 italic">
          No metrics available - container metrics will appear here...
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(metrics).map(([name, value]) => (
            <div
              key={name}
              className="flex justify-between items-center p-2 bg-gray-900 bg-opacity-30 rounded hover:bg-opacity-50 transition-colors duration-150"
              style={{ fontFamily: 'Consolas, "Courier New", monospace' }}
            >
              <span className="text-yellow-300 font-medium">
                {name.replace(/_/g, " ").toUpperCase()}:
              </span>
              <span className="font-bold text-yellow-400">
                {typeof value === "number"
                  ? value.toLocaleString()
                  : (value as any)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

