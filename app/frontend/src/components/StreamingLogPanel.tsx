// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef } from "react";

/** Auto-scrolling terminal-style panel for live-streamed command output. */
export default function StreamingLogPanel({ output }: { output: string }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [output]);

  if (!output) return null;

  return (
    <div className="rounded-md border border-stone-700/60 bg-stone-950/90 overflow-hidden">
      <div className="max-h-32 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-stone-300 whitespace-pre-wrap break-all">
        {output}
        <div ref={endRef} />
      </div>
    </div>
  );
}
