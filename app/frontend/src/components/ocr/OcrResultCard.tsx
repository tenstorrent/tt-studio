// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/*
 * One image and the text read off it.
 *
 * The status chip vocabulary deliberately matches ui/gentle-file-upload.tsx so
 * a queue of images reads the same here as it does in RAG.
 */

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  RotateCcw,
  Scissors,
  X,
} from "lucide-react";

import { cn } from "@/src/lib/utils";
import { Progress } from "@/src/components/ui/progress";
import { Spinner } from "@/src/components/ui/spinner";
import MarkdownComponent from "../chatui/MarkdownComponent";
import type { OcrItem } from "./useOcrRun";

export interface OcrResultCardProps {
  item: OcrItem;
  index: number;
  /** A run is in flight, so retry and remove would race it. */
  disabled: boolean;
  showRaw: boolean;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

export function OcrResultCard({
  item,
  index,
  disabled,
  showRaw,
  onRetry,
  onRemove,
}: OcrResultCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!item.text) return;
    await navigator.clipboard.writeText(item.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [item.text]);

  const isRunning = item.status === "running";
  const isDone = item.status === "done";
  const isFailed = item.status === "failed";
  const isCancelled = item.status === "cancelled";
  const isTruncated = isDone && item.finishReason === "length";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden bg-white dark:bg-neutral-900 flex flex-col p-4 w-full rounded-lg border shadow-sm transition-all",
        isRunning && "border-blue-300 dark:border-blue-800/60",
        isDone && "border-green-300 dark:border-green-800/60",
        isFailed && "border-red-300 dark:border-red-800/60",
        !isRunning &&
          !isDone &&
          !isFailed &&
          "border-neutral-200 dark:border-neutral-800",
      )}
    >
      <div className="flex justify-between w-full items-center gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <img
            src={item.previewUrl}
            alt={item.file.name}
            className="w-12 h-12 rounded-md object-cover border border-neutral-200 dark:border-neutral-800 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate"
              title={item.file.name}
            >
              {index + 1}. {item.file.name}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {(item.file.size / (1024 * 1024)).toFixed(2)} MB
              {item.elapsedMs != null && isDone
                ? ` • ${(item.elapsedMs / 1000).toFixed(1)}s`
                : ""}
              {item.usage?.completion_tokens != null
                ? ` • ${item.usage.completion_tokens} tokens`
                : ""}
              {/* A large page is read in strips, which is why it takes longer. */}
              {item.tiles != null && item.tiles > 1
                ? ` • read in ${item.tiles} strips`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isTruncated && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              <Scissors className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Truncated</span>
            </span>
          )}
          {isRunning && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              <Spinner size="xs" />
              <span className="hidden sm:inline">Reading</span>
            </span>
          )}
          {isDone && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300 border border-green-200 dark:border-green-800">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Read</span>
            </span>
          )}
          {isFailed && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Failed</span>
            </span>
          )}
          {item.status === "queued" && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700">
              Queued
            </span>
          )}
          {isCancelled && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700">
              Cancelled
            </span>
          )}

          {isDone && item.text ? (
            <button
              type="button"
              onClick={handleCopy}
              title="Copy this page"
              className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          ) : null}

          {(isFailed || isCancelled) && (
            <button
              type="button"
              onClick={() => onRetry(item.id)}
              disabled={disabled}
              title="Read this image again"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
          )}

          <button
            type="button"
            onClick={() => onRemove(item.id)}
            disabled={isRunning}
            title="Remove"
            className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isRunning && (
        <div className="w-full mt-3">
          <Progress
            value={100}
            className="h-1 w-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden"
            indicatorClassName="bg-blue-600 dark:bg-blue-500 animate-pulse"
          />
        </div>
      )}

      {isFailed && item.error && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400 break-words">
          {item.error}
        </p>
      )}

      {isTruncated && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          The model hit its token limit, so this page may be cut short.
        </p>
      )}

      {isDone && (
        <div className="mt-3 border-t border-neutral-200 dark:border-neutral-800 pt-3">
          {item.text ? (
            <div className="max-h-96 overflow-auto text-sm text-neutral-800 dark:text-neutral-200">
              {showRaw ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                  {item.text}
                </pre>
              ) : (
                <MarkdownComponent>{item.text}</MarkdownComponent>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              No text found in this image.
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}

export default OcrResultCard;
