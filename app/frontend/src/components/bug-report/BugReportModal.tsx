// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState } from "react";
import {
  Bug,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Copy,
  GitBranch,
  ExternalLink,
  Clock,
  ChevronRight,
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
    isSubmitting,
    issueResult,
    startCollection,
    downloadZip,
    createGitHubIssue,
    copyToClipboard,
    reset,
  } = useBugReport();

  const [copied, setCopied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);

  const handleClose = () => {
    onOpenChange(false);
    // Small delay so the modal closes before state resets (avoids visual flash)
    setTimeout(reset, 300);
  };

  const handleCopy = async () => {
    await copyToClipboard();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = async () => {
    setDownloadError(null);
    try {
      await downloadZip();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed");
    }
  };

  const handleCreateIssue = async () => {
    setIssueError(null);
    try {
      await createGitHubIssue();
    } catch (err) {
      setIssueError(
        err instanceof Error ? err.message : "Failed to create issue"
      );
    }
  };

  const doneCount = sources.filter((s) => s.status === "done" || s.status === "error").length;
  const totalCount = sources.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
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
            <div className="space-y-1">
              <label className="text-sm font-medium">
                Issue title{" "}
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
              <Button variant="outline" onClick={handleClose}>
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

            {issueResult?.created_via_api && issueResult.issue_url && (
              <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm">
                <p className="font-medium text-blue-800 dark:text-blue-300">
                  Issue #{issueResult.issue_number} created!
                </p>
                <a
                  href={issueResult.issue_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-600 dark:text-blue-400 underline mt-1"
                >
                  {issueResult.issue_url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {issueError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {issueError}
              </p>
            )}
            {downloadError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {downloadError}
              </p>
            )}

            <div className="grid grid-cols-1 gap-2">
              <Button
                onClick={handleCreateIssue}
                disabled={isSubmitting || !!issueResult?.created_via_api}
                className="w-full justify-center gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GitBranch className="h-4 w-4" />
                )}
                {issueResult?.created_via_api
                  ? "Issue Created"
                  : "Create GitHub Issue"}
              </Button>

              <Button
                variant="outline"
                onClick={handleDownload}
                className="w-full justify-center gap-2"
              >
                <Download className="h-4 w-4" />
                Download Logs as ZIP
              </Button>

              <Button
                variant="outline"
                onClick={handleCopy}
                className="w-full justify-center gap-2"
              >
                <Copy className="h-4 w-4" />
                {copied ? "Copied!" : "Copy Report to Clipboard"}
              </Button>
            </div>

            <div className="flex justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  reset();
                }}
              >
                Start Over
              </Button>
              <Button variant="outline" size="sm" onClick={handleClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
