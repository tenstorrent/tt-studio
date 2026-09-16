// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/*
 * Actions over the whole run's text.
 *
 * The rendered/raw switch is here rather than per card because PaddleOCR-VL
 * emits markdown -- tables, LaTeX -- and the renderer therefore hides part of
 * what the model actually said. Copy and download always take the raw text, so
 * what lands on the clipboard is the model's output either way.
 */

import { useCallback, useState } from "react";
import { Check, Copy, Download, Eye, FileCode, Trash2 } from "lucide-react";

import { Button } from "@/src/components/ui/button";

export interface OcrResultsToolbarProps {
  text: string;
  pageCount: number;
  showRaw: boolean;
  onToggleRaw: () => void;
  onClear: () => void;
  clearDisabled?: boolean;
}

export function OcrResultsToolbar({
  text,
  pageCount,
  showRaw,
  onToggleRaw,
  onClear,
  clearDisabled = false,
}: OcrResultsToolbarProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyAll = useCallback(async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  const handleDownload = useCallback(() => {
    if (!text) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ocr-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [text]);

  return (
    <div className="flex flex-wrap items-center gap-2 justify-between rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {pageCount} {pageCount === 1 ? "page" : "pages"} read
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onToggleRaw}>
          {showRaw ? (
            <>
              <Eye className="w-4 h-4 mr-1.5" />
              Rendered
            </>
          ) : (
            <>
              <FileCode className="w-4 h-4 mr-1.5" />
              Raw text
            </>
          )}
        </Button>

        <Button variant="outline" size="sm" onClick={handleCopyAll}>
          {copied ? (
            <>
              <Check className="w-4 h-4 mr-1.5 text-green-600" />
              Copied
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-1.5" />
              Copy all
            </>
          )}
        </Button>

        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="w-4 h-4 mr-1.5" />
          Download .txt
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
          disabled={clearDisabled}
        >
          <Trash2 className="w-4 h-4 mr-1.5" />
          Clear
        </Button>
      </div>
    </div>
  );
}

export default OcrResultsToolbar;
