// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, useCallback } from "react";
import type {
  BugReportData,
  BugReportForm,
  BugReportStep,
  LogSourceState,
  SupportEmailDraft,
} from "./types";

const INITIAL_FORM: BugReportForm = {
  title: "",
  description: "",
  steps: "",
  expected: "",
  actual: "",
};

const INITIAL_SOURCES: LogSourceState[] = [
  { label: "Backend (Django) logs", key: "backend_log", status: "pending" },
  { label: "Model run logs", key: "model_run_log", status: "pending" },
  {
    label: "Per-deployment model run logs",
    key: "model_run_deployment_logs",
    status: "pending",
  },
  {
    label: "Docker control service logs",
    key: "docker_control_log",
    status: "pending",
  },
  { label: "Startup logs", key: "startup_log", status: "pending" },
  { label: "Agent logs", key: "agent_log", status: "pending" },
  {
    label: "Inference model run logs",
    key: "inference_run_logs",
    status: "pending",
  },
  {
    label: "Inference docker server logs",
    key: "inference_docker_server_logs",
    status: "pending",
  },
  { label: "tt-smi hardware data", key: "tt_smi", status: "pending" },
  { label: "Deployment history", key: "deployments", status: "pending" },
  {
    label: "Current deployed models (snapshot)",
    key: "current_models",
    status: "pending",
  },
];

const SUPPORT_ROTATION = [
  { name: "Anirudh", email: "aramchandran@tenstorrent.com" },
  { name: "Jashan", email: "jashansingh@tenstorrent.com" },
  { name: "Raheem", email: "rnabeel@tenstorrent.com" },
] as const;

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

// Mirrors the backend builder (app/backend/logs_control/support_email.py):
// mailto: bodies beyond ~2000 chars get truncated by common mail clients and
// browsers; everything heavy lives in the attached ZIP anyway.
const MAX_MAILTO_BODY = 1800;
const TRUNCATION_NOTICE = "\n[truncated — full details in the attached ZIP]";
const SUPPORT_EMAIL = "support@tenstorrent.com";
const EMAIL_ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** Build the mailto: link locally from the draft's structured fields.
 * The scheme is a constant, the recipient must be a plain email address, and
 * the subject/body are percent-encoded, so no server-supplied URL is ever
 * handed to a navigable DOM sink (XSS hardening). */
function buildMailtoUrl(to: string, subject: string, body: string): string {
  const recipient = EMAIL_ADDRESS.test(to) ? to : SUPPORT_EMAIL;
  let mailBody = body;
  if (mailBody.length > MAX_MAILTO_BODY) {
    mailBody =
      mailBody.slice(0, MAX_MAILTO_BODY - TRUNCATION_NOTICE.length) +
      TRUNCATION_NOTICE;
  }
  return (
    `mailto:${recipient}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(mailBody)}`
  );
}

/** Plain-text fallback when the support-email draft endpoint is unreachable —
 * mirrors the backend's email body closely enough to paste into a mail client. */
function buildFallbackEmailBody(
  form: BugReportForm,
  diagnosticsRef: string
): string {
  const field = (v: string) => v.trim() || "_fill in_";
  return `Assignee: ${currentSupportAssignee()}
Reference: ${diagnosticsRef}

TT-Studio bug report. Do not edit the Assignee/Reference lines — Jira
automation reads them.

## Summary
${field(form.title)}

## Description
${field(form.description)}

## Steps to Reproduce
${field(form.steps)}

## Expected / Actual
${field(form.expected)} / ${field(form.actual)}

--
IMPORTANT: attach tt-studio-logs-${diagnosticsRef}.zip to this email before sending.
Sent from TT-Studio bug reporter.`;
}

export function useBugReport() {
  const [step, setStep] = useState<BugReportStep>("form");
  const [form, setForm] = useState<BugReportForm>(INITIAL_FORM);
  const [sources, setSources] = useState<LogSourceState[]>(INITIAL_SOURCES);
  const [data, setData] = useState<BugReportData | null>(null);
  /** Stable id for matching a support ticket to one downloaded diagnostics ZIP. */
  const [diagnosticsRef, setDiagnosticsRef] = useState<string | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isBuildingEml, setIsBuildingEml] = useState(false);
  const [emailDraft, setEmailDraft] = useState<SupportEmailDraft | null>(null);

  const startCollection = useCallback(async () => {
    setStep("collecting");
    setDiagnosticsRef(null);
    setSources(INITIAL_SOURCES.map((s) => ({ ...s, status: "loading" })));

    try {
      const response = await fetch("/logs-api/bug-report/");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const collected: BugReportData = await response.json();
      setData(collected);
      setDiagnosticsRef(makeDiagnosticsRef());

      // Mark sources as done/error based on actual content
      setSources(
        INITIAL_SOURCES.map((s) => {
          const value = (collected as unknown as Record<string, unknown>)[s.key];
          let status: LogSourceState["status"] = "done";
          if (value === undefined || value === null) {
            status = "error";
          } else if (
            typeof value === "object" &&
            !Array.isArray(value) &&
            "error" in (value as object)
          ) {
            status = "error";
          } else if (Array.isArray(value) && value.length === 0) {
            status = "done"; // empty is ok — just nothing to show
          }
          return { ...s, status };
        })
      );

      setStep("actions");
    } catch (err) {
      console.error("Bug report collection failed:", err);
      setDiagnosticsRef(null);
      setSources((prev) => prev.map((s) => ({ ...s, status: "error" })));
    }
  }, []);

  const downloadZip = useCallback(async () => {
    const response = await fetch("/logs-api/bug-report/download/");
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    const slug =
      diagnosticsRef ??
      new Date().toISOString().replace(/[:.]/g, "-");
    saveBlob(await response.blob(), `tt-studio-logs-${slug}.zip`);
  }, [diagnosticsRef]);

  /** JSON body shared by the support-email endpoints. */
  const supportEmailPayload = useCallback(
    (ref: string) =>
      JSON.stringify({
        ref,
        title: form.title.trim(),
        description: form.description.trim(),
        steps: form.steps.trim(),
        expected: form.expected.trim(),
        actual: form.actual.trim(),
      }),
    [form]
  );

  /** Download a ready-to-send .eml addressed to support with the diagnostics
   * ZIP already attached — open it in a mail client and hit Send. */
  const downloadEmailWithLogs = useCallback(async () => {
    const ref = diagnosticsRef ?? makeDiagnosticsRef();
    if (!diagnosticsRef) setDiagnosticsRef(ref);
    setIsBuildingEml(true);
    try {
      const response = await fetch("/logs-api/support-email/eml/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: supportEmailPayload(ref),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }
      saveBlob(await response.blob(), `tt-studio-bug-report-${ref}.eml`);
    } finally {
      setIsBuildingEml(false);
    }
  }, [diagnosticsRef, supportEmailPayload]);

  const draftSupportEmail = useCallback(async () => {
    const ref = diagnosticsRef ?? makeDiagnosticsRef();
    if (!diagnosticsRef) setDiagnosticsRef(ref);
    setIsDrafting(true);
    try {
      const response = await fetch("/logs-api/support-email/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: supportEmailPayload(ref),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }
      const draft: SupportEmailDraft = await response.json();
      setEmailDraft(draft);

      // Open the pre-filled draft in the user's default mail client. The link
      // is assembled here from the draft's fields rather than taken from the
      // response, so the navigated URL is always a mailto: we constructed.
      const a = document.createElement("a");
      a.href = buildMailtoUrl(draft.to, draft.subject, draft.body);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to draft support email:", err);
      throw err;
    } finally {
      setIsDrafting(false);
    }
  }, [diagnosticsRef, supportEmailPayload]);

  /** Copy the email body — the drafted one when available, else a local fallback. */
  const copyEmailBody = useCallback(async () => {
    const ref = diagnosticsRef ?? makeDiagnosticsRef();
    const text = emailDraft?.body ?? buildFallbackEmailBody(form, ref);
    await navigator.clipboard.writeText(text);
  }, [diagnosticsRef, emailDraft, form]);

  const reset = useCallback(() => {
    setStep("form");
    setForm(INITIAL_FORM);
    setSources(INITIAL_SOURCES);
    setData(null);
    setDiagnosticsRef(null);
    setIsDrafting(false);
    setIsBuildingEml(false);
    setEmailDraft(null);
  }, []);

  return {
    step,
    form,
    setForm,
    sources,
    data,
    diagnosticsRef,
    isDrafting,
    isBuildingEml,
    emailDraft,
    startCollection,
    downloadZip,
    downloadEmailWithLogs,
    draftSupportEmail,
    copyEmailBody,
    reset,
  };
}
