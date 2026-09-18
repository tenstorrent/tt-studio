// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import {
  Bug,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Copy,
  Mail,
  Clock,
  ChevronRight,
  ChevronDown,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { cn } from "../../lib/utils";
import { useBugReport } from "./useBugReport";
import type { LogSourceState } from "./types";

interface BugReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SourceStatusIcon({ status }: { status: LogSourceState["status"] }) {
  switch (status) {
    case "loading":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case "done":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-amber-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

export function BugReportModal({ open, onOpenChange }: BugReportModalProps) {
  const {
    step,
    form,
    setForm,
    sources,
    diagnosticsRef,
    isDrafting,
    emailDraft,
    startCollection,
    downloadZip,
    draftSupportEmail,
    copyEmailBody,
    reset,
  } = useBugReport();

  const [copied, setCopied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [diagnosticsHelpOpen, setDiagnosticsHelpOpen] = useState(false);
  /** Step 3: user confirms they attached the ZIP to the email before sending */
  const [confirmedZipAttached, setConfirmedZipAttached] = useState(false);
  const [copiedZipFileName, setCopiedZipFileName] = useState(false);
  const [copiedDiagRefId, setCopiedDiagRefId] = useState(false);

  const closeModal = () => {
    setDiagnosticsHelpOpen(false);
    setConfirmedZipAttached(false);
    setCopiedZipFileName(false);
    setCopiedDiagRefId(false);
    onOpenChange(false);
    // Small delay so the modal closes before state resets (avoids visual flash)
    setTimeout(reset, 300);
  };

  const handleCopy = async () => {
    await copyEmailBody();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyZipDownloadFileName = async (fileName: string) => {
    await navigator.clipboard.writeText(fileName);
    setCopiedZipFileName(true);
    setTimeout(() => setCopiedZipFileName(false), 2000);
  };

  const copyDiagnosticsRefOnly = async (ref: string) => {
    await navigator.clipboard.writeText(ref);
    setCopiedDiagRefId(true);
    setTimeout(() => setCopiedDiagRefId(false), 2000);
  };

  const handleDownload = async () => {
    setDownloadError(null);
    try {
      await downloadZip();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleDraftEmail = async () => {
    setDraftError(null);
    try {
      await draftSupportEmail();
    } catch (err) {
      setDraftError(
        err instanceof Error ? err.message : "Failed to draft the support email"
      );
    }
  };

  const doneCount = sources.filter((s) => s.status === "done" || s.status === "error").length;
  const totalCount = sources.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeModal();
      }}
    >
      <DialogContent className="max-w-2xl w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Bug className="h-5 w-5 text-red-500" />
            Report a Bug
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <span
            className={
              step === "form"
                ? "font-semibold text-foreground"
                : "opacity-50"
            }
          >
            1. Describe
          </span>
          <ChevronRight className="h-3 w-3" />
          <span
            className={
              step === "collecting"
                ? "font-semibold text-foreground"
                : "opacity-50"
            }
          >
            2. Collect Logs
          </span>
          <ChevronRight className="h-3 w-3" />
          <span
            className={
              step === "actions"
                ? "font-semibold text-foreground"
                : "opacity-50"
            }
          >
            3. Submit
          </span>
        </div>

        {/* ── Step 1: Form ── */}
        {step === "form" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Describe what went wrong, then use{" "}
              <strong className="text-foreground">Collect Logs</strong> on the next
              steps to bundle diagnostics. In{" "}
              <strong className="text-foreground">step 3</strong> you’ll send it all
              to Tenstorrent support by email.
            </p>

            <Collapsible
              open={diagnosticsHelpOpen}
              onOpenChange={setDiagnosticsHelpOpen}
              className="rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/50"
            >
              <CollapsibleTrigger
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-foreground",
                  "hover:bg-stone-100/80 dark:hover:bg-stone-800/50 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
                )}
              >
                <span>What we collect &amp; where the report goes</span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                    diagnosticsHelpOpen && "rotate-180"
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden">
                <div className="border-t border-stone-200 dark:border-stone-800 px-4 pb-4 pt-1 text-sm text-stone-700 dark:text-stone-300 leading-relaxed space-y-3">
                  <p>
                    After your notes, TT-Studio collects a diagnostic snapshot:
                    backend and{" "}
                    <code className="rounded bg-stone-200 px-1 py-0.5 text-xs dark:bg-stone-800">
                      tt-inference-server
                    </code>{" "}
                    logs, deployment history, inference artifacts, and TT device
                    data from{" "}
                    <code className="rounded bg-stone-200 px-1 py-0.5 text-xs dark:bg-stone-800">
                      tt-smi
                    </code>{" "}
                    (board, telemetry, firmware fields when available).
                  </p>
                  <p>
                    In <strong>step 3</strong>, download the ZIP, then click{" "}
                    <strong>Draft support email</strong> — a pre-filled email to{" "}
                    <code className="rounded bg-stone-200 px-1 py-0.5 text-xs dark:bg-stone-800">
                      support@tenstorrent.com
                    </code>{" "}
                    opens in your mail client. Attach the ZIP and hit Send; the
                    support inbox files the ticket and replies come back to your
                    inbox. A short <strong>ZIP / diagnostics reference</strong>{" "}
                    links the email to your downloaded file name.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
            <div className="space-y-1">
              <label className="text-sm font-medium">
                Title{" "}
                <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                placeholder="Brief summary of the bug"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                The email subject becomes:{" "}
                <span className="font-medium text-foreground/80">
                  [TT-Studio] …your title… [reference]
                </span>{" "}
                (reference is added when you collect logs).
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="What went wrong?"
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Steps to reproduce</label>
              <Textarea
                placeholder="1. …&#10;2. …&#10;3. …"
                rows={3}
                value={form.steps}
                onChange={(e) =>
                  setForm((f) => ({ ...f, steps: e.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Expected behavior</label>
                <Textarea
                  placeholder="What should have happened?"
                  rows={2}
                  value={form.expected}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, expected: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Actual behavior</label>
                <Textarea
                  placeholder="What actually happened?"
                  rows={2}
                  value={form.actual}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, actual: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button onClick={startCollection}>
                Collect Logs
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Collecting ── */}
        {step === "collecting" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Gathering logs from all TT-Studio services…{" "}
              <span className="font-medium text-foreground">
                {doneCount}/{totalCount}
              </span>
            </p>
            <div className="rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50/80 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-900 dark:text-blue-200">
              We are collecting backend,{" "}
              <code className="rounded bg-blue-100 px-1 py-0.5 text-xs dark:bg-blue-900/60">
                tt-inference-server
              </code>
              , startup, agent, and docker-control logs, plus deployment history,
              recent inference artifacts, and TT device details from{" "}
              <code className="rounded bg-blue-100 px-1 py-0.5 text-xs dark:bg-blue-900/60">
                tt-smi
              </code>
              . This may include board type, telemetry, and firmware-related fields
              returned by the device. When this step finishes, you will get a{" "}
              <strong>ZIP / diagnostics reference</strong> (e.g.{" "}
              <code className="rounded bg-blue-100 px-1 py-0.5 text-xs dark:bg-blue-900/60">
                ttbr-…
              </code>
              ) to tie your download to the support email.
            </div>
            <ScrollArea className="h-64 pr-2">
              <div className="space-y-2">
                {sources.map((source) => (
                  <div
                    key={source.key}
                    className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                  >
                    <SourceStatusIcon status={source.status} />
                    <span className="flex-1">{source.label}</span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {source.status}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* ── Step 3: Actions ── */}
        {step === "actions" && (
          <div className="space-y-4">
            <div className="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-4 py-3 text-sm text-green-800 dark:text-green-300">
              Logs collected from{" "}
              {sources.filter((s) => s.status === "done").length} of{" "}
              {totalCount} sources.{" "}
              {sources.filter((s) => s.status === "error").length > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {sources.filter((s) => s.status === "error").length} source(s)
                  unavailable — included as partial data.
                </span>
              )}
            </div>

            {diagnosticsRef && (
              <div className="rounded-md border border-stone-300 dark:border-stone-600 bg-stone-100/90 dark:bg-stone-900/80 px-4 py-3 text-sm space-y-3">
                <div>
                  <p className="font-medium text-foreground mb-1">
                    ZIP / diagnostics reference
                  </p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Your browser saves the bundle with this full file name (same as
                    Download Logs as ZIP). Copy it to find the file when attaching
                    it to the email.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Download file name
                  </p>
                  <div className="flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-950 px-2 py-1.5 text-xs font-mono leading-snug">
                      {`tt-studio-logs-${diagnosticsRef}.zip`}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      title="Copy file name"
                      aria-label="Copy download file name"
                      onClick={() =>
                        copyZipDownloadFileName(
                          `tt-studio-logs-${diagnosticsRef}.zip`
                        )
                      }
                    >
                      {copiedZipFileName ? (
                        <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    Reference ID (email subject/body)
                  </p>
                  <div className="flex items-start gap-2">
                    <code className="min-w-0 flex-1 break-all rounded border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-950 px-2 py-1.5 text-xs font-mono leading-snug">
                      {diagnosticsRef}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      title="Copy reference ID"
                      aria-label="Copy diagnostics reference ID"
                      onClick={() => copyDiagnosticsRefOnly(diagnosticsRef)}
                    >
                      {copiedDiagRefId ? (
                        <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50/90 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
              <p className="font-medium mb-1">How submission works</p>
              <ol className="list-decimal list-inside space-y-1 text-amber-900/90 dark:text-amber-100/90">
                <li>
                  Click <strong>Download Logs as ZIP</strong> below. The file name
                  includes the reference above so it lines up with the email.
                </li>
                <li>
                  Click <strong>Draft support email</strong> — a pre-filled email
                  to <strong>support@tenstorrent.com</strong> opens in your mail
                  client.
                </li>
                <li>
                  <strong>Attach the downloaded ZIP</strong> to the email (email
                  drafts can’t attach it automatically), then hit{" "}
                  <strong>Send</strong>. Support replies land back in your inbox.
                </li>
              </ol>
            </div>

            {emailDraft && (
              <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm space-y-1">
                <p className="font-medium text-blue-800 dark:text-blue-300">
                  Email draft opened in your mail client.
                </p>
                <p className="text-blue-900/90 dark:text-blue-200/90">
                  To: <span className="font-mono text-xs">{emailDraft.to}</span>
                </p>
                <p className="text-blue-900/90 dark:text-blue-200/90 break-all">
                  Subject:{" "}
                  <span className="font-mono text-xs">{emailDraft.subject}</span>
                </p>
                <p className="text-blue-900/90 dark:text-blue-200/90">
                  This week’s triage assignee: {emailDraft.assignee.name}
                </p>
                <p className="text-xs text-blue-800/80 dark:text-blue-300/80">
                  Nothing opened? Use <strong>Copy Email Body</strong> below and
                  compose the email yourself.
                </p>
              </div>
            )}

            {draftError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {draftError}
              </p>
            )}
            {downloadError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {downloadError}
              </p>
            )}

            <div className="grid grid-cols-1 gap-2">
              <Button
                variant="outline"
                onClick={handleDownload}
                className="w-full justify-center gap-2"
                title={
                  diagnosticsRef
                    ? `Saves as tt-studio-logs-${diagnosticsRef}.zip`
                    : undefined
                }
              >
                <Download className="h-4 w-4" />
                Download Logs as ZIP
              </Button>

              <Button
                onClick={handleDraftEmail}
                disabled={isDrafting}
                className="w-full justify-center gap-2"
              >
                {isDrafting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                {emailDraft ? "Draft Again" : "Draft Support Email"}
              </Button>

              <Button
                variant="outline"
                onClick={handleCopy}
                className="w-full justify-center gap-2"
              >
                <Copy className="h-4 w-4" />
                {copied ? "Copied!" : "Copy Email Body"}
              </Button>
            </div>

            <div className="rounded-md border border-stone-200 dark:border-stone-700 bg-stone-50/90 dark:bg-stone-900/60 px-4 py-3">
              <label
                htmlFor="bug-report-confirm-email-zip"
                className="flex cursor-pointer items-start gap-3"
              >
                <input
                  id="bug-report-confirm-email-zip"
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 rounded border-stone-400 text-stone-900 focus-visible:ring-2 focus-visible:ring-stone-400 dark:border-stone-500 dark:bg-stone-950"
                  checked={confirmedZipAttached}
                  onChange={(e) => setConfirmedZipAttached(e.target.checked)}
                />
                <span className="text-sm leading-snug text-stone-800 dark:text-stone-200">
                  I attached the diagnostics ZIP to the support email before
                  sending it.
                </span>
              </label>
              {!confirmedZipAttached && (
                <p className="mt-2 pl-7 text-xs text-muted-foreground">
                  Tick this when you’re done so you don’t forget — support needs
                  the ZIP to debug.
                </p>
              )}
            </div>

            <div className="flex justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfirmedZipAttached(false);
                  setCopiedZipFileName(false);
                  setCopiedDiagRefId(false);
                  reset();
                }}
              >
                Start Over
              </Button>
              <Button variant="outline" size="sm" onClick={closeModal}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
