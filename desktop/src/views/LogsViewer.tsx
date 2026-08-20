// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Logs viewer: tails the launcher's own log files (bring-up NDJSON streams
// and stderr logs in the app data dirs) with level filtering, copy and
// export. Read-only over the IPC surface in logs.rs.

import { useCallback, useEffect, useState } from "react";
import {
  exportAppLog,
  listAppLogs,
  readAppLog,
  type LogFileInfo,
} from "../lib/ipc";
import {
  classifyLog,
  filterByLevel,
  formatSize,
  type LogLevel,
} from "../lib/logs";

const TAIL_INTERVAL_MS = 2000;

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "text-zinc-300",
  warn: "text-amber-300",
  error: "text-red-300",
};

function LogsViewer({ onBack }: { onBack: () => void }) {
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [selected, setSelected] = useState<LogFileInfo | null>(null);
  const [content, setContent] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [level, setLevel] = useState<LogLevel>("info");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listAppLogs()
      .then((found) => {
        setFiles(found);
        setSelected((prev) => prev ?? found[0] ?? null);
      })
      .catch((e) => setNotice(String(e)));
  }, []);

  // Tail the selected file while the view is open.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const load = () =>
      readAppLog(selected.name)
        .then((tail) => {
          if (cancelled) return;
          setContent(tail.content);
          setTruncated(tail.truncated);
        })
        .catch((e) => !cancelled && setNotice(String(e)));
    load();
    const timer = setInterval(load, TAIL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selected]);

  const lines = filterByLevel(
    classifyLog(content, selected?.ndjson ?? false),
    selected?.ndjson ? level : "info",
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(lines.map((l) => l.raw).join("\n"))
      .then(() => setNotice("Copied to the clipboard."))
      .catch((e) => setNotice(String(e)));
  }, [lines]);

  const handleExport = useCallback(() => {
    if (!selected) return;
    exportAppLog(selected.name)
      .then((path) => setNotice(path ? `Exported to ${path}` : null))
      .catch((e) => setNotice(String(e)));
  }, [selected]);

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-zinc-950 p-6 text-zinc-100">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Launcher logs</h1>
        <button
          type="button"
          onClick={onBack}
          data-testid="logs-back"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          Back
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select
          data-testid="logs-file"
          value={selected?.name ?? ""}
          onChange={(e) =>
            setSelected(files.find((f) => f.name === e.target.value) ?? null)
          }
          className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-300"
        >
          {files.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name} ({formatSize(f.size_bytes)})
            </option>
          ))}
        </select>
        {selected?.ndjson && (
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Level:
            <select
              data-testid="logs-level"
              value={level}
              onChange={(e) => setLevel(e.target.value as LogLevel)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
            >
              <option value="info">everything</option>
              <option value="warn">warnings & errors</option>
              <option value="error">errors only</option>
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={handleCopy}
          data-testid="logs-copy"
          className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={handleExport}
          data-testid="logs-export"
          className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
        >
          Export…
        </button>
      </div>

      {truncated && (
        <p className="text-xs text-zinc-500">
          Showing the newest 512 KB — export for the full file.
        </p>
      )}
      {notice && (
        <p data-testid="logs-notice" className="text-xs text-zinc-400">
          {notice}
        </p>
      )}

      <pre
        data-testid="logs-body"
        className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs leading-5"
      >
        {files.length === 0
          ? "No launcher logs yet — they appear after the first bring-up."
          : lines.map((l, i) => (
              <div key={i} className={LEVEL_STYLE[l.level]}>
                {selected?.ndjson ? l.text : l.raw}
              </div>
            ))}
      </pre>
    </main>
  );
}

export default LogsViewer;
