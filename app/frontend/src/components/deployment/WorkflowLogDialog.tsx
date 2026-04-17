// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { Button } from "../ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, RotateCcw, UserX, Zap } from "lucide-react";
import { useWorkflowLogStream } from "../../hooks/useWorkflowLogStream";
import { parseAnsiColors } from "../../lib/ansi";
import LogView from "../models/Logs/LogView";

interface Props {
  open: boolean;
  deploymentId: number | null;
  modelName?: string;
  diedUnexpectedly?: boolean;
  stoppedByUser?: boolean;
  onClose: () => void;
  onRequestBoardReset?: () => void;
}

const ALL_LEVELS = ["INFO", "DEBUG", "TRACE", "ERROR", "WARNING", "FATAL"] as const;

const LEVEL_COLORS: Record<string, { active: string; inactive: string }> = {
  INFO:    { active: "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40",    inactive: "text-zinc-600 hover:text-zinc-400" },
  DEBUG:   { active: "bg-zinc-600/30 text-zinc-300 ring-1 ring-zinc-500/40", inactive: "text-zinc-600 hover:text-zinc-400" },
  TRACE:   { active: "bg-zinc-700/30 text-zinc-400 ring-1 ring-zinc-600/40", inactive: "text-zinc-600 hover:text-zinc-400" },
  ERROR:   { active: "bg-red-500/20 text-red-300 ring-1 ring-red-500/40",    inactive: "text-zinc-600 hover:text-zinc-400" },
  WARNING: { active: "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40", inactive: "text-zinc-600 hover:text-zinc-400" },
  FATAL:   { active: "bg-red-700/30 text-red-200 ring-1 ring-red-600/50",    inactive: "text-zinc-600 hover:text-zinc-400" },
};

const CRITICAL_LEVELS = new Set(["ERROR", "FATAL", "CRITICAL"]);

export default function WorkflowLogDialog({
  open,
  deploymentId,
  modelName,
  diedUnexpectedly,
  stoppedByUser,
  onClose,
  onRequestBoardReset,
}: Props) {
  const navigate = useNavigate();
  const { logs, error, isLoading, isComplete } = useWorkflowLogStream(open, deploymentId);
  const logsRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [activeLevels, setActiveLevels] = useState<Set<string>>(
    () => new Set(ALL_LEVELS)
  );

  const allActive = activeLevels.size === ALL_LEVELS.length;

  const toggleLevel = (level: string) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const resetLevels = () => setActiveLevels(new Set(ALL_LEVELS));

  const filterLog = useCallback(
    (line: string) => {
      if (allActive) return true;
      const parsed = parseAnsiColors(line);
      if (!parsed.level) return false;
      return activeLevels.has(parsed.level);
    },
    [activeLevels, allActive]
  );

  const filteredCount = useMemo(() => {
    if (allActive) return logs.length;
    return logs.filter(filterLog).length;
  }, [logs, filterLog, allActive]);

  const criticalErrors = useMemo(
    () =>
      logs
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => {
          const { level } = parseAnsiColors(line);
          return level && CRITICAL_LEVELS.has(level);
        }),
    [logs]
  );

  const showHardwareBanner = useMemo(
    () =>
      logs.some(
        (line) =>
          line.includes("TT_THROW") &&
          (line.includes("ethernet core") || line.includes("resetting the board"))
      ),
    [logs]
  );

  useEffect(() => {
    if (!open) {
      setAutoScrollEnabled(true);
      setShowScrollButton(false);
    }
  }, [open]);

  useEffect(() => {
    if (autoScrollEnabled && !isComplete && logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs, autoScrollEnabled, isComplete]);

  useEffect(() => {
    if (!isComplete) return;
    if (diedUnexpectedly && criticalErrors.length > 0) {
      requestAnimationFrame(() => {
        const target = logsRef.current?.querySelector(
          `[data-log-index="${criticalErrors[0].index}"]`
        );
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          setAutoScrollEnabled(false);
          setShowScrollButton(true);
        }
      });
    } else if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [isComplete]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = () => {
    if (logsRef.current) {
      const isAtBottom =
        logsRef.current.scrollHeight -
          logsRef.current.scrollTop -
          logsRef.current.clientHeight <
        10;
      setAutoScrollEnabled(isAtBottom);
      setShowScrollButton(!isAtBottom);
    }
  };

  const scrollToBottom = () => {
    if (logsRef.current) {
      logsRef.current.scrollTo({ top: logsRef.current.scrollHeight, behavior: "smooth" });
      setAutoScrollEnabled(true);
      setShowScrollButton(false);
    }
  };

  const scrollToLogLine = useCallback((originalIndex: number) => {
    setActiveLevels(new Set(ALL_LEVELS));
    requestAnimationFrame(() => {
      const target = logsRef.current?.querySelector(
        `[data-log-index="${originalIndex}"]`
      );
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setAutoScrollEnabled(false);
        setShowScrollButton(true);
      }
    });
  }, []);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-6xl h-[90vh] flex flex-col gap-0 p-0 overflow-hidden"
        style={{
          background: "linear-gradient(180deg, #0e0f12 0%, #0a0b0e 100%)",
          border: "1px solid #1c1e24",
          boxShadow: "0 25px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        {/* ── Header ── */}
        <DialogHeader
          className="px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid #1a1c22" }}
        >
          <DialogTitle
            className="flex items-center gap-3"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", letterSpacing: "-0.01em" }}
          >
            <span
              className="text-xs font-bold tracking-widest uppercase px-2 py-0.5 rounded"
              style={{ background: "#1a1c22", color: "#6b7280" }}
            >
              LOG
            </span>
            <span className="text-white font-semibold text-base">Workflow Output</span>
            {modelName && (
              <span
                className="text-sm font-normal"
                style={{ color: "#4b5563" }}
              >
                / {modelName}
              </span>
            )}
            {isLoading && (
              <span
                className="ml-auto text-xs font-mono flex items-center gap-1.5"
                style={{ color: "#22c55e" }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full bg-green-500"
                  style={{ animation: "pulse 1.5s ease-in-out infinite" }}
                />
                STREAMING
              </span>
            )}
            {isComplete && (
              <span
                className="ml-auto text-xs font-mono"
                style={{ color: "#4b5563" }}
              >
                {logs.length} lines
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0 px-4 py-3 gap-3">
          {/* ── Stopped by user banner ── */}
          {stoppedByUser && isComplete && (
            <div
              className="shrink-0 flex items-center gap-3 rounded-lg px-4 py-3"
              style={{
                background: "linear-gradient(135deg, #052e16 0%, #03210f 100%)",
                border: "1px solid #166534",
                boxShadow: "0 0 16px rgba(34,197,94,0.08), inset 0 1px 0 rgba(34,197,94,0.08)",
              }}
            >
              <UserX className="h-4 w-4 shrink-0" style={{ color: "#4ade80" }} />
              <div className="min-w-0">
                <p
                  className="text-xs font-bold tracking-wide uppercase"
                  style={{ fontFamily: "'JetBrains Mono', monospace", color: "#4ade80", letterSpacing: "0.08em" }}
                >
                  Stopped by User
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#16a34a" }}>
                  This model was intentionally stopped. You can deploy a new model from the main page.
                </p>
              </div>
            </div>
          )}

          {/* ── Died unexpectedly banner ── */}
          {/* TODO: track unexpected exits server-side (exit code, OOM, hardware fault) so we can
              surface auto-reset options and avoid requiring manual intervention before re-deploy. */}
          {diedUnexpectedly && isComplete && (
            <div
              className="shrink-0 flex items-start gap-3 rounded-lg px-4 py-3"
              style={{
                background: "linear-gradient(135deg, #3b0a0a 0%, #2a0707 100%)",
                border: "1px solid #b91c1c",
                boxShadow: "0 0 24px rgba(239,68,68,0.18), inset 0 1px 0 rgba(239,68,68,0.1)",
              }}
            >
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-bold tracking-wide uppercase"
                  style={{ fontFamily: "'JetBrains Mono', monospace", color: "#fca5a5", letterSpacing: "0.08em" }}
                >
                  Model Crashed Unexpectedly
                </p>
                <p className="text-xs mt-1" style={{ color: "#f87171" }}>
                  This model stopped without being shut down by you — it may have crashed, run out of memory, or hit a hardware fault.
                  We recommend performing a <strong style={{ color: "#fca5a5" }}>board reset</strong> before deploying a new model.
                  Check the deployment history for a full record of this run.
                </p>
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <button
                    onClick={() => { onClose(); navigate("/deployment-history"); }}
                    className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded transition-all duration-150"
                    style={{
                      background: "#450a0a",
                      color: "#fca5a5",
                      border: "1px solid #7f1d1d",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                    onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = "#7f1d1d"; }}
                    onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = "#450a0a"; }}
                  >
                    <ExternalLink className="h-3 w-3" />
                    View Deployment History
                  </button>
                  {onRequestBoardReset && (
                    <button
                      onClick={() => { onClose(); onRequestBoardReset(); }}
                      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded transition-all duration-150"
                      style={{
                        background: "#dc2626",
                        color: "#fff",
                        border: "1px solid #ef4444",
                        fontFamily: "'JetBrains Mono', monospace",
                        boxShadow: "0 0 12px rgba(239,68,68,0.3)",
                      }}
                      onMouseOver={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = "#ef4444";
                        el.style.boxShadow = "0 0 20px rgba(239,68,68,0.5)";
                      }}
                      onMouseOut={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = "#dc2626";
                        el.style.boxShadow = "0 0 12px rgba(239,68,68,0.3)";
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset Board Now
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Hardware error banner ── */}
          {showHardwareBanner && (
            <div
              className="shrink-0 flex items-start gap-3 rounded-lg px-4 py-3"
              style={{
                background: "linear-gradient(135deg, #3d1f00 0%, #2a1500 100%)",
                border: "1px solid #92400e",
                boxShadow: "0 0 20px rgba(245,158,11,0.12), inset 0 1px 0 rgba(245,158,11,0.1)",
              }}
            >
              <Zap className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-bold tracking-wide uppercase"
                  style={{ fontFamily: "'JetBrains Mono', monospace", color: "#fbbf24", letterSpacing: "0.08em" }}
                >
                  TT Hardware Fault
                </p>
                <p className="text-xs mt-1" style={{ color: "#d97706" }}>
                  Ethernet core timeout detected (
                  <code
                    className="font-mono px-1 rounded"
                    style={{ background: "#451a03", color: "#fcd34d" }}
                  >
                    TT_THROW
                  </code>
                  ). Board must be reset before next deployment.
                </p>
              </div>
              <button
                onClick={() => { onClose(); onRequestBoardReset?.(); }}
                className="shrink-0 flex items-center gap-2 text-xs font-bold tracking-wide uppercase transition-all duration-150 px-3 py-2 rounded"
                style={{
                  background: "#92400e",
                  color: "#fef3c7",
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.06em",
                  border: "1px solid #b45309",
                }}
                onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = "#b45309"; }}
                onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = "#92400e"; }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Board
              </button>
            </div>
          )}

          {/* ── Critical errors panel ── */}
          {criticalErrors.length > 0 && (
            <Collapsible
              defaultOpen={diedUnexpectedly}
              className="shrink-0 rounded-lg overflow-hidden"
              style={{
                border: diedUnexpectedly ? "1px solid #7f1d1d" : "1px solid #3f1010",
                boxShadow: diedUnexpectedly ? "0 0 24px rgba(239,68,68,0.15)" : "none",
              }}
            >
              <CollapsibleTrigger
                className="w-full flex items-center justify-between px-4 py-2.5 group transition-colors duration-150"
                style={{ background: diedUnexpectedly ? "#1c0808" : "#140505" }}
              >
                <div className="flex items-center gap-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "#ef4444" }} />
                  <span
                    className="text-sm font-bold tracking-wide"
                    style={{ fontFamily: "'JetBrains Mono', monospace", color: "#fca5a5" }}
                  >
                    Critical Errors
                  </span>
                  <span
                    className="text-xs font-mono px-1.5 py-0.5 rounded"
                    style={{ background: "#7f1d1d", color: "#fca5a5" }}
                  >
                    {criticalErrors.length}
                  </span>
                </div>
                <ChevronRight
                  className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90"
                  style={{ color: "#7f1d1d" }}
                />
              </CollapsibleTrigger>

              <CollapsibleContent>
                {/* Error line list */}
                <div
                  className="max-h-36 overflow-y-auto"
                  style={{ borderTop: "1px solid #3f1010", background: "#0f0404" }}
                >
                  {criticalErrors.map(({ line, index }) => (
                    <button
                      key={index}
                      onClick={() => scrollToLogLine(index)}
                      className="w-full text-left flex items-baseline gap-3 py-1 px-4 transition-colors duration-100 group/item"
                      style={{ borderBottom: "1px solid #1a0808" }}
                      onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = "#1c0808"; }}
                      onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <span
                        className="text-xs font-mono w-7 text-right shrink-0 select-none"
                        style={{ color: "#6b2121" }}
                      >
                        {index + 1}
                      </span>
                      <span
                        className="text-xs font-mono truncate"
                        style={{ color: "#fca5a5", fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                      >
                        {parseAnsiColors(line).text.slice(0, 120)}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Reset board CTA — only when no banner above already shows one */}
                {onRequestBoardReset && !showHardwareBanner && !diedUnexpectedly && (
                  <div
                    className="flex items-center justify-between px-4 py-3 gap-4"
                    style={{
                      borderTop: "1px solid #7f1d1d",
                      background: "linear-gradient(90deg, #1f0808 0%, #180606 100%)",
                    }}
                  >
                    <div className="min-w-0">
                      <p
                        className="text-xs font-bold tracking-widest uppercase"
                        style={{ color: "#ef4444", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em" }}
                      >
                        Hardware Reset Required
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#7f1d1d" }}>
                        The board may be in a failed state. Reset before retrying deployment.
                      </p>
                    </div>
                    <button
                      onClick={() => { onClose(); onRequestBoardReset(); }}
                      className="shrink-0 flex items-center gap-2 font-bold transition-all duration-150 px-4 py-2 rounded"
                      style={{
                        background: "#dc2626",
                        color: "#fff",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "0.75rem",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        border: "1px solid #ef4444",
                        boxShadow: "0 0 16px rgba(239,68,68,0.3)",
                        whiteSpace: "nowrap",
                      }}
                      onMouseOver={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = "#ef4444";
                        el.style.boxShadow = "0 0 24px rgba(239,68,68,0.5)";
                      }}
                      onMouseOut={(e) => {
                        const el = e.currentTarget as HTMLElement;
                        el.style.background = "#dc2626";
                        el.style.boxShadow = "0 0 16px rgba(239,68,68,0.3)";
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset Board
                    </button>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* ── Filter bar ── */}
          <div
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg"
            style={{ background: "#0e0f12", border: "1px solid #1a1c22" }}
          >
            <span
              className="text-xs font-mono mr-2 tracking-widest uppercase"
              style={{ color: "#374151", letterSpacing: "0.1em" }}
            >
              Filter
            </span>
            {ALL_LEVELS.map((level) => {
              const isActive = activeLevels.has(level);
              const colors = LEVEL_COLORS[level];
              return (
                <button
                  key={level}
                  onClick={() => toggleLevel(level)}
                  className={`px-2 py-0.5 rounded text-xs font-mono font-medium transition-all duration-100 ${
                    isActive ? colors.active : colors.inactive
                  }`}
                  style={{ letterSpacing: "0.04em" }}
                >
                  {level}
                </button>
              );
            })}
            {!allActive && (
              <button
                onClick={resetLevels}
                className="px-2 py-0.5 rounded text-xs font-mono transition-colors duration-100 ml-1"
                style={{ color: "#4b5563", background: "#1a1c22" }}
                onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.color = "#9ca3af"; }}
                onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.color = "#4b5563"; }}
              >
                all
              </button>
            )}
            <span
              className="text-xs font-mono ml-auto tabular-nums"
              style={{ color: "#374151" }}
            >
              {filteredCount === logs.length
                ? `${logs.length}`
                : `${filteredCount}/${logs.length}`}{" "}
              lines
            </span>
          </div>

          {/* ── Log area ── */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {isLoading && (
              <div className="flex items-center justify-center h-64 gap-3">
                <Spinner />
                <span
                  className="text-sm font-mono"
                  style={{ color: "#4b5563" }}
                >
                  connecting to stream…
                </span>
              </div>
            )}

            {error && (
              <div
                className="p-4 rounded-lg mb-3"
                style={{ background: "#1a0808", border: "1px solid #7f1d1d", color: "#fca5a5" }}
              >
                <p className="text-sm font-mono font-bold">stream error</p>
                <p className="text-xs mt-1 opacity-70">{error}</p>
              </div>
            )}

            {!isLoading && !error && (
              <div className="flex-1 min-h-0 relative overflow-hidden">
                <LogView
                  logs={logs}
                  filterLog={filterLog}
                  onScroll={handleScroll}
                  scrollRef={logsRef}
                />
                {showScrollButton && (
                  <Button
                    onClick={scrollToBottom}
                    className="absolute bottom-4 right-4 rounded-full p-2 h-9 w-9 shadow-lg"
                    style={{
                      background: "#1a1c22",
                      border: "1px solid #2d3039",
                      color: "#9ca3af",
                    }}
                    variant="secondary"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
