// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { Bug, Loader2, Download, Copy, Mail, Paperclip } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";
import { useBugReport } from "./useBugReport";

interface BugReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BugReportModal({ open, onOpenChange }: BugReportModalProps) {
  const {
    step,
    form,
    setForm,
    zipFileName,
    emlFileName,
    isDownloading,
    draftSupportEmail,
    downloadEmailWithLogs,
    downloadAgain,
    copyEmailBody,
    reset,
  } = useBugReport();

  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = form.description.trim() !== "" && form.steps.trim() !== "";

  const closeModal = () => {
    setError(null);
    onOpenChange(false);
    // Small delay so the modal closes before state resets (avoids visual flash)
    setTimeout(reset, 300);
  };

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleCopy = async () => {
    await copyEmailBody();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

        {step === "form" && (
          <div className="space-y-4">
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
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">What went wrong?</label>
              <Textarea
                required
                placeholder="What happened, and what were you doing when it did?"
                rows={4}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Steps to reproduce</label>
              <Textarea
                required
                placeholder="1. …&#10;2. …&#10;3. …"
                rows={3}
                value={form.steps}
                onChange={(e) =>
                  setForm((f) => ({ ...f, steps: e.target.value }))
                }
              />
            </div>
            {!canSubmit && (
              <p className="text-xs text-muted-foreground">
                Fill in what went wrong and the steps to reproduce to continue.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={!canSubmit}
                onClick={() => run(downloadEmailWithLogs)}
                className="gap-2"
              >
                <Paperclip className="h-4 w-4" />
                Download Email with Logs Attached
              </Button>
              <Button
                disabled={!canSubmit}
                onClick={() => run(draftSupportEmail)}
                className="gap-2"
              >
                <Mail className="h-4 w-4" />
                Draft Support Email
              </Button>
            </div>
          </div>
        )}

        {step === "drafted" && (
          <div className="space-y-4">
            {isDownloading ? (
              <div className="flex items-center gap-3 rounded-md border px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                Your email is open. Downloading your logs…
              </div>
            ) : error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : (
              <div className="space-y-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
                <p className="flex items-center gap-2 font-semibold">
                  <Paperclip className="h-4 w-4 shrink-0" />
                  One more step: attach your logs
                </p>
                <p>
                  Your mail app opened an email to support@tenstorrent.com, and
                  your logs downloaded as a ZIP.
                </p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>
                    Drag{" "}
                    <span className="break-all font-mono text-xs">
                      {zipFileName}
                    </span>{" "}
                    from your Downloads into the email that just opened.
                  </li>
                  <li>
                    Hit <strong>Send</strong>.
                  </li>
                </ol>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Mail app didn’t open? Copy the email body and send it to
              support@tenstorrent.com yourself.
            </p>
            <div className="flex flex-wrap justify-between gap-2 pt-1">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="gap-2"
                >
                  <Copy className="h-4 w-4" />
                  {copied ? "Copied!" : "Copy Email Body"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => run(downloadAgain)}
                  disabled={isDownloading}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download ZIP Again
                </Button>
              </div>
              <Button size="sm" onClick={closeModal}>
                Done
              </Button>
            </div>
          </div>
        )}

        {step === "downloaded" && (
          <div className="space-y-4">
            {isDownloading ? (
              <div className="flex items-center gap-3 rounded-md border px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                Collecting your logs and building the email…
              </div>
            ) : error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : (
              <div className="space-y-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
                <p className="flex items-center gap-2 font-semibold">
                  <Mail className="h-4 w-4 shrink-0" />
                  One more step: send the email
                </p>
                <p>
                  We saved an email to support@tenstorrent.com with your logs
                  already inside.
                </p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>
                    Open{" "}
                    <span className="break-all font-mono text-xs">
                      {emlFileName}
                    </span>{" "}
                    from your Downloads.
                  </li>
                  <li>
                    Hit <strong>Send</strong>. If it opens as a received message
                    instead of a draft, hit <strong>Forward</strong> and send it
                    to support@tenstorrent.com. The logs stay attached.
                  </li>
                </ol>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => run(downloadAgain)}
                disabled={isDownloading}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Download Email Again
              </Button>
              <Button size="sm" onClick={closeModal}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
