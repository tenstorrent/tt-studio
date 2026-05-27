// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import { useState } from "react";

export interface ToolCallView {
  id: string;
  tool: string;
  input?: string;
  output_summary?: string;
  status: "running" | "done";
}

interface Props {
  call: ToolCallView;
}

export function ToolCallBlock({ call }: Props) {
  const [open, setOpen] = useState(false);
  const running = call.status === "running";

  return (
    <div className="my-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wrench className="h-3.5 w-3.5" />
        )}
        <span className="font-medium text-foreground">{call.tool}</span>
        <span className="text-muted-foreground">
          {running ? "running…" : "complete"}
        </span>
        <span className="ml-auto">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {call.input && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Input
              </p>
              <pre className="whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[11px] leading-snug">
                {call.input}
              </pre>
            </div>
          )}
          {call.output_summary && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Output
              </p>
              <pre className="whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[11px] leading-snug">
                {call.output_summary}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
