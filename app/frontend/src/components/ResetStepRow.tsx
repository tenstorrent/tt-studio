// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, type ReactNode } from "react";
import { CheckCircle, Loader2, XCircle } from "lucide-react";

export type StepRowState = "pending" | "active" | "done" | "skipped" | "error";

/** Auto-scrolling per-step log output (used during a reset/delete stream). */
function StepLogPanel({ logs }: { logs: string[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <div className="mt-2 rounded-md border border-stone-200 dark:border-stone-700/60 bg-stone-50 dark:bg-stone-950/80 overflow-hidden">
      <div className="max-h-32 overflow-y-auto overflow-x-hidden px-3 py-2 font-mono text-[11px] leading-relaxed text-stone-600 dark:text-stone-400 scrollbar-thin scrollbar-thumb-stone-300 dark:scrollbar-thumb-stone-700">
        {logs.map((line, i) => {
          const lower = line.toLowerCase();
          const tone =
            lower.includes("error") || lower.includes("failed")
              ? "text-red-600 dark:text-red-400"
              : lower.includes("success") ||
                  lower.includes("completed") ||
                  lower.includes("successfully")
                ? "text-green-600 dark:text-green-400"
                : lower.includes("warning")
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "";
          return (
            <div key={i} className={`py-px break-all ${tone}`}>
              {line}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}

/**
 * Shared progress row for the reset / delete-reset dialogs.
 *
 * Supersedes the three near-identical `StepRow` copies that lived in
 * DeleteModelDialog, MultiCardResetDialog and ResetIcon. Theme-aware base
 * (so ResetIcon keeps light-mode support); renders identically in dark for the
 * dialogs that are always dark.
 */
export default function ResetStepRow({
  number,
  icon,
  label,
  sublabel,
  state,
  logs,
  skippedLabel = "Skipped",
}: {
  number: number;
  icon: ReactNode;
  label: string;
  sublabel?: string;
  state: StepRowState;
  logs?: string[];
  skippedLabel?: string;
}) {
  return (
    <div
      className={`p-3 rounded-lg border transition-all duration-300 ${
        state === "active"
          ? "bg-blue-50 border-blue-200 dark:bg-blue-900/30 dark:border-blue-500/40"
          : state === "done"
            ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-600/30"
            : state === "error"
              ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-600/30"
              : state === "skipped"
                ? "bg-stone-50 border-stone-200 dark:bg-stone-800/30 dark:border-stone-700/30"
                : "bg-stone-50 border-stone-200 dark:bg-stone-800/50 dark:border-stone-700/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 flex items-center justify-center shrink-0 mt-0.5">
          {state === "active" ? (
            <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
          ) : state === "done" ? (
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
          ) : state === "error" ? (
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          ) : state === "skipped" ? (
            <CheckCircle className="w-5 h-5 text-stone-500" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-stone-200 dark:bg-stone-600 flex items-center justify-center text-xs font-bold text-stone-700 dark:text-stone-300">
              {number}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={`font-medium text-sm inline-flex items-center gap-1.5 ${
              state === "pending" || state === "skipped"
                ? "text-stone-600 dark:text-stone-400"
                : state === "error"
                  ? "text-red-700 dark:text-red-300"
                  : "text-stone-950 dark:text-white"
            }`}
          >
            {icon}
            {label}
          </div>
          {sublabel && state === "active" && (
            <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              {sublabel}
            </div>
          )}
          {state === "done" && (
            <div className="text-xs text-green-700 dark:text-green-400 mt-0.5">
              Completed
            </div>
          )}
          {state === "skipped" && (
            <div className="text-xs text-stone-500 dark:text-stone-500 mt-0.5">
              {skippedLabel}
            </div>
          )}
          {state === "error" && (
            <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">
              Failed
            </div>
          )}
        </div>
      </div>

      {logs && <StepLogPanel logs={logs} />}
    </div>
  );
}
