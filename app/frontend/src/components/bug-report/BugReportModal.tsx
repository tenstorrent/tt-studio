// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { Bug, CheckCircle2, Loader2, Download, Copy, Mail } from "lucide-react";
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
    isDownloadingZip,
    draftSupportEmail,
    downloadZipAgain,
    copyEmailBody,
    reset,
  } = useBugReport();

  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : "Logs download failed");
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
                placeholder="What happened, and what were you doing when it did?"
                rows={5}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Your mail app opens with the report addressed to
              support@tenstorrent.com, and your TT-Studio logs download as a
              ZIP to attach.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeModal}>
                Cancel
              </Button>
              <Button onClick={() => run(draftSupportEmail)} className="gap-2">
                <Mail className="h-4 w-4" />
                Draft Support Email
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            {isDownloadingZip ? (
              <div className="flex items-center gap-3 rounded-md border px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                Your email is open. Downloading your logs…
              </div>
            ) : error ? (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            ) : (
              <div className="flex items-start gap-3 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-4 py-3 text-sm text-green-800 dark:text-green-300">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <p>
                  Your email to support@tenstorrent.com is open. Drag the logs
                  ZIP from your Downloads into it, then hit{" "}
                  <strong>Send</strong>.
                </p>
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
                  onClick={() => run(downloadZipAgain)}
                  disabled={isDownloadingZip}
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
      </DialogContent>
    </Dialog>
  );
}
