// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useCallback } from "react";
import type { BugReportForm, BugReportStep } from "./types";

const INITIAL_FORM: BugReportForm = { title: "", description: "", steps: "" };

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

const zipFileName = (ref: string) => `tt-studio-logs-${ref}.zip`;
const emlFileName = (ref: string) => `tt-studio-bug-report-${ref}.eml`;

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
Logs: attach ${zipFileName(diagnosticsRef)} from your Downloads before sending.

## Summary
${field(form.title)}

## Description
${field(form.description)}

## Steps to Reproduce
${field(form.steps)}

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
  const [isDownloading, setIsDownloading] = useState(false);

  const saveZip = useCallback(async (ref: string) => {
    setIsDownloading(true);
    try {
      const response = await fetch("/logs-api/bug-report/download/");
      if (!response.ok) {
        throw new Error(`Logs download failed: HTTP ${response.status}`);
      }
      saveBlob(await response.blob(), zipFileName(ref));
    } finally {
      setIsDownloading(false);
    }
  }, []);

  /** The backend collects the logs and builds the .eml with the ZIP
   * attached, so the user only has to open it and hit Send. */
  const saveEml = useCallback(
    async (ref: string) => {
      setIsDownloading(true);
      try {
        const response = await fetch("/logs-api/support-email/eml/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ref,
            title: form.title.trim(),
            description: form.description.trim(),
            steps: form.steps.trim(),
          }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error ?? `HTTP ${response.status}`);
        }
        saveBlob(await response.blob(), emlFileName(ref));
      } finally {
        setIsDownloading(false);
      }
    },
    [form]
  );

  /** Open the mail app on a filled-in draft to support, then download the
   * logs ZIP for the user to drag in (mailto: cannot carry attachments). The
   * draft opens first, synchronously inside the click, because browsers only
   * let a user action launch the mail app. */
  const draftSupportEmail = useCallback(async () => {
    const ref = makeDiagnosticsRef();
    setDiagnosticsRef(ref);
    openMailDraft(buildSubject(form.title, ref), buildEmailBody(form, ref));
    setStep("drafted");
    await saveZip(ref);
  }, [form, saveZip]);

  const downloadEmailWithLogs = useCallback(async () => {
    const ref = makeDiagnosticsRef();
    setDiagnosticsRef(ref);
    setStep("downloaded");
    await saveEml(ref);
  }, [saveEml]);

  /** Retry whichever file this report produced. */
  const downloadAgain = useCallback(async () => {
    if (!diagnosticsRef) return;
    await (step === "downloaded" ? saveEml : saveZip)(diagnosticsRef);
  }, [diagnosticsRef, step, saveEml, saveZip]);

  const copyEmailBody = useCallback(async () => {
    if (!diagnosticsRef) return;
    await navigator.clipboard.writeText(buildEmailBody(form, diagnosticsRef));
  }, [diagnosticsRef, form]);

  const reset = useCallback(() => {
    setStep("form");
    setForm(INITIAL_FORM);
    setDiagnosticsRef(null);
    setIsDownloading(false);
  }, []);

  return {
    step,
    form,
    setForm,
    zipFileName: diagnosticsRef ? zipFileName(diagnosticsRef) : null,
    emlFileName: diagnosticsRef ? emlFileName(diagnosticsRef) : null,
    isDownloading,
    draftSupportEmail,
    downloadEmailWithLogs,
    downloadAgain,
    copyEmailBody,
    reset,
  };
}
