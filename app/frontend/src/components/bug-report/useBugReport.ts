// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useCallback } from "react";
import type { BugReportForm, BugReportStep } from "./types";

const INITIAL_FORM: BugReportForm = { title: "", description: "" };

const SUPPORT_ROTATION = [
  { name: "Anirudh", email: "aramchandran@tenstorrent.com" },
  { name: "Jashan", email: "jashansingh@tenstorrent.com" },
  { name: "Raheem", email: "rnabeel@tenstorrent.com" },
] as const;

// Mirrors the backend builder (app/backend/logs_control/support_email.py):
// mailto: bodies beyond ~2000 chars get truncated by common mail clients and
// browsers; everything heavy lives in the ZIP anyway.
const MAX_MAILTO_BODY = 1800;
const MAX_SUBJECT_TITLE = 100;
const TRUNCATION_NOTICE = "\n[truncated — full details in the attached ZIP]";
const SUPPORT_EMAIL = "support@tenstorrent.com";

function makeDiagnosticsRef(): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `ttbr-${suffix}`;
}

/** Trigger a browser download of `blob` under `filename`. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function currentSupportAssignee(): string {
  const today = new Date();
  const isoDate = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  );
  const isoDay = isoDate.getUTCDay() || 7;
  isoDate.setUTCDate(isoDate.getUTCDate() + 4 - isoDay);
  const yearStart = new Date(Date.UTC(isoDate.getUTCFullYear(), 0, 1));
  const isoWeek =
    Math.ceil((1 + (isoDate.getTime() - yearStart.getTime()) / 86_400_000) / 7);
  const assignee = SUPPORT_ROTATION[isoWeek % SUPPORT_ROTATION.length];
  return `${assignee.name} <${assignee.email}>`;
}

function buildSubject(title: string, diagnosticsRef: string): string {
  let summary = title.trim() || "Bug report";
  if (summary.length > MAX_SUBJECT_TITLE) {
    summary = summary.slice(0, MAX_SUBJECT_TITLE - 1) + "…";
  }
  return `[TT-Studio] ${summary} [${diagnosticsRef}]`;
}

/** The attach reminder sits at the top so mailto: truncation of a long
 * description can never cut it off. */
function buildEmailBody(form: BugReportForm, diagnosticsRef: string): string {
  const field = (v: string) => v.trim() || "_fill in_";
  return `Assignee: ${currentSupportAssignee()}
Reference: ${diagnosticsRef}

TT-Studio bug report. Do not edit the Assignee/Reference lines — Jira
automation reads them.
Logs: attach tt-studio-logs-${diagnosticsRef}.zip from your Downloads before sending.

## Summary
${field(form.title)}

## Description
${field(form.description)}

--
Sent from TT-Studio bug reporter.`;
}

/** Open the user's mail app on a draft to support. The recipient is a
 * constant and the subject/body are percent-encoded, so nothing
 * user-supplied can change where the link points. */
function openMailDraft(subject: string, body: string): void {
  let mailBody = body;
  if (mailBody.length > MAX_MAILTO_BODY) {
    mailBody =
      mailBody.slice(0, MAX_MAILTO_BODY - TRUNCATION_NOTICE.length) +
      TRUNCATION_NOTICE;
  }
  const a = document.createElement("a");
  a.href =
    `mailto:${SUPPORT_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(mailBody)}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function useBugReport() {
  const [step, setStep] = useState<BugReportStep>("form");
  const [form, setForm] = useState<BugReportForm>(INITIAL_FORM);
  /** Stable id for matching a support ticket to one diagnostics ZIP. */
  const [diagnosticsRef, setDiagnosticsRef] = useState<string | null>(null);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  const saveZip = useCallback(async (ref: string) => {
    setIsDownloadingZip(true);
    try {
      const response = await fetch("/logs-api/bug-report/download/");
      if (!response.ok) {
        throw new Error(`Logs download failed: HTTP ${response.status}`);
      }
      saveBlob(await response.blob(), `tt-studio-logs-${ref}.zip`);
    } finally {
      setIsDownloadingZip(false);
    }
  }, []);

  /** Open the mail app on a filled-in draft to support, then download the
   * logs ZIP for the user to drag in (mailto: cannot carry attachments). The
   * draft opens first, synchronously inside the click, because browsers only
   * let a user action launch the mail app. */
  const draftSupportEmail = useCallback(async () => {
    const ref = makeDiagnosticsRef();
    setDiagnosticsRef(ref);
    openMailDraft(buildSubject(form.title, ref), buildEmailBody(form, ref));
    setStep("done");
    await saveZip(ref);
  }, [form, saveZip]);

  const downloadZipAgain = useCallback(async () => {
    if (diagnosticsRef) await saveZip(diagnosticsRef);
  }, [diagnosticsRef, saveZip]);

  const copyEmailBody = useCallback(async () => {
    if (!diagnosticsRef) return;
    await navigator.clipboard.writeText(buildEmailBody(form, diagnosticsRef));
  }, [diagnosticsRef, form]);

  const reset = useCallback(() => {
    setStep("form");
    setForm(INITIAL_FORM);
    setDiagnosticsRef(null);
    setIsDownloadingZip(false);
  }, []);

  return {
    step,
    form,
    setForm,
    zipFileName: diagnosticsRef ? `tt-studio-logs-${diagnosticsRef}.zip` : null,
    isDownloadingZip,
    draftSupportEmail,
    downloadZipAgain,
    copyEmailBody,
    reset,
  };
}
