// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Check, Code2, Download, Brain } from "lucide-react";
import { codeToHtml } from "shiki";

interface CanvasCodeViewProps {
  code: string | null;
  streamingText: string;
  streamingThinking?: string;
  isStreaming: boolean;
}

export default function CanvasCodeView({
  code,
  streamingText,
  streamingThinking,
  isStreaming,
}: CanvasCodeViewProps) {
  const [highlighted, setHighlighted] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const displayCode = code || "";

  useEffect(() => {
    if (!displayCode) {
      setHighlighted("");
      return;
    }

    let cancelled = false;
    codeToHtml(displayCode, {
      lang: "html",
      theme: "github-dark-default",
    }).then((html) => {
      if (!cancelled) setHighlighted(html);
    });

    return () => {
      cancelled = true;
    };
  }, [displayCode]);

  const isThinking = isStreaming && !streamingText && !!streamingThinking;

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingText, streamingThinking, isStreaming]);

  const handleCopy = useCallback(async () => {
    if (!displayCode) return;
    await navigator.clipboard.writeText(displayCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [displayCode]);

  const handleDownload = useCallback(() => {
    if (!displayCode) return;
    const blob = new Blob([displayCode], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "canvas-output.html";
    a.click();
    URL.revokeObjectURL(url);
  }, [displayCode]);

  if (!code && !isStreaming) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400 gap-3 p-8">
        <Code2 className="w-8 h-8 text-zinc-400 dark:text-zinc-500" />
        <p className="text-sm text-center max-w-48">
          Generated code will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 shrink-0">
        <div className="flex items-center gap-2">
          <Code2 className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            HTML
          </span>
          {isStreaming && (
            <motion.span
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="text-xs text-violet-400"
            >
              Generating...
            </motion.span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDownload}
            disabled={!displayCode}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-30"
            title="Download HTML"
          >
            <Download className="w-3.5 h-3.5 text-zinc-500" />
          </button>
          <button
            onClick={handleCopy}
            disabled={!displayCode}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-30"
            title="Copy code"
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.div
                  key="check"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <Check className="w-3.5 h-3.5 text-green-400" />
                </motion.div>
              ) : (
                <motion.div
                  key="copy"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                >
                  <Copy className="w-3.5 h-3.5 text-zinc-500" />
                </motion.div>
              )}
            </AnimatePresence>
          </button>
        </div>
      </div>

      {/* Code content */}
      <div
        ref={scrollRef}
        className="grow overflow-auto bg-[#0d1117] text-sm text-left [&_*]:text-left"
      >
        {isThinking ? (
          <div className="p-4 text-left">
            <div className="flex items-center gap-2 mb-3">
              <motion.div
                animate={{ rotate: [0, 10, -10, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <Brain className="w-4 h-4 text-violet-400" />
              </motion.div>
              <motion.span
                className="text-xs font-medium text-violet-400"
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                Reasoning before coding...
              </motion.span>
            </div>
            <pre className="text-xs leading-relaxed text-zinc-500 whitespace-pre-wrap font-mono text-left">
              {streamingThinking}
            </pre>
          </div>
        ) : highlighted ? (
          <div
            className="p-4 text-left [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!text-left [&_code]:!text-xs [&_code]:!leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <pre className="p-4 text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap font-mono text-left">
            {isStreaming ? streamingText : displayCode}
          </pre>
        )}
      </div>
    </div>
  );
}
