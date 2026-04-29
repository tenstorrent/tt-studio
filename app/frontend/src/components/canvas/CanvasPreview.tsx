// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, AlertTriangle, Maximize2, Minimize2 } from "lucide-react";
import type { CanvasError } from "./useCanvasState";

interface CanvasPreviewProps {
  code: string | null;
  isStreaming: boolean;
  errors: CanvasError[];
  onError: (errors: CanvasError[]) => void;
}

const ERROR_HANDLER_SCRIPT = `
<script>
(function() {
  var errors = [];
  function send() {
    window.parent.postMessage({ type: 'canvas-errors', errors: errors }, '*');
  }
  window.onerror = function(msg, src, line, col) {
    errors.push({ message: String(msg), line: line, col: col });
    send();
    return true;
  };
  window.addEventListener('unhandledrejection', function(e) {
    errors.push({ message: 'Unhandled promise rejection: ' + String(e.reason) });
    send();
  });
  var origLog = console.error;
  console.error = function() {
    var msg = Array.prototype.slice.call(arguments).join(' ');
    errors.push({ message: msg });
    send();
    origLog.apply(console, arguments);
  };
  window.addEventListener('load', function() {
    window.parent.postMessage({ type: 'canvas-loaded' }, '*');
  });
})();
</script>
`;

function injectErrorHandler(html: string): string {
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return (
      html.slice(0, headClose) + ERROR_HANDLER_SCRIPT + html.slice(headClose)
    );
  }
  const htmlOpen = html.indexOf("<html");
  if (htmlOpen !== -1) {
    const tagEnd = html.indexOf(">", htmlOpen);
    if (tagEnd !== -1) {
      return (
        html.slice(0, tagEnd + 1) +
        "<head>" +
        ERROR_HANDLER_SCRIPT +
        "</head>" +
        html.slice(tagEnd + 1)
      );
    }
  }
  return ERROR_HANDLER_SCRIPT + html;
}

export default function CanvasPreview({
  code,
  isStreaming,
  errors,
  onError,
}: CanvasPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (event.data?.type === "canvas-errors") {
        onError(event.data.errors);
      }
      if (event.data?.type === "canvas-loaded") {
        setIsLoaded(true);
      }
    },
    [onError],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    if (!code || !iframeRef.current) return;
    setIsLoaded(false);
    const injected = injectErrorHandler(code);
    iframeRef.current.srcdoc = injected;
  }, [code]);

  const handleRefresh = () => {
    if (!code || !iframeRef.current) return;
    onError([]);
    setIsLoaded(false);
    const injected = injectErrorHandler(code);
    iframeRef.current.srcdoc = injected;
  };

  if (!code && !isStreaming) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400 gap-3 p-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-violet-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
            />
          </svg>
        </div>
        <p className="text-sm font-medium">Live Preview</p>
        <p className="text-xs text-center max-w-48 text-zinc-400 dark:text-zinc-500">
          Ask the AI to build something and the preview will appear here
        </p>
      </div>
    );
  }

  if (isStreaming && !code) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <RefreshCw className="w-6 h-6 text-violet-400" />
        </motion.div>
        <p className="text-sm text-zinc-400">Generating code...</p>
      </div>
    );
  }

  return (
    <div
      className={`relative flex flex-col h-full ${isFullscreen ? "fixed inset-0 z-[100] bg-white dark:bg-zinc-900" : ""}`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Preview
          </span>
          {!isLoaded && code && (
            <motion.div
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="text-xs text-amber-500"
            >
              Loading...
            </motion.div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {errors.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-400 mr-1">
              <AlertTriangle className="w-3 h-3" />
              {errors.length} error{errors.length > 1 ? "s" : ""}
            </span>
          )}
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            title="Refresh preview"
          >
            <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5 text-zinc-500" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5 text-zinc-500" />
            )}
          </button>
        </div>
      </div>

      {/* Iframe */}
      <div className="grow relative">
        <iframe
          ref={iframeRef}
          title="Canvas Preview"
          sandbox="allow-scripts allow-modals allow-forms allow-popups"
          className="absolute inset-0 w-full h-full border-0 bg-white"
        />
      </div>

      {/* Error overlay */}
      <AnimatePresence>
        {errors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-0 left-0 right-0 max-h-32 overflow-auto bg-red-950/95 border-t border-red-800 text-red-200 text-xs p-3 font-mono"
          >
            {errors.map((err, i) => (
              <div key={i} className="mb-1 last:mb-0">
                <span className="text-red-400">
                  {err.line ? `Line ${err.line}` : "Error"}:
                </span>{" "}
                {err.message}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
