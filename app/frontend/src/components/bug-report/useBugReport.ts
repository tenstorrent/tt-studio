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

function makeDiagnosticsRef(): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `ttbr-${suffix}`;
}

/** Plain-text fallback when the support-email draft endpoint is unreachable —
 * mirrors the backend's email body closely enough to paste into a mail client. */
function buildFallbackEmailBody(
  form: BugReportForm,
  diagnosticsRef: string
): string {
  const field = (v: string) => v.trim() || "_fill in_";
  return `Reference: ${diagnosticsRef}

TT-Studio bug report.

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
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug =
      diagnosticsRef ??
      new Date().toISOString().replace(/[:.]/g, "-");
    a.download = `tt-studio-logs-${slug}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [diagnosticsRef]);

  const draftSupportEmail = useCallback(async () => {
    const ref = diagnosticsRef ?? makeDiagnosticsRef();
    if (!diagnosticsRef) setDiagnosticsRef(ref);
    setIsDrafting(true);
    try {
      const response = await fetch("/logs-api/support-email/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref,
          title: form.title.trim(),
          description: form.description.trim(),
          steps: form.steps.trim(),
          expected: form.expected.trim(),
          actual: form.actual.trim(),
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }
      const draft: SupportEmailDraft = await response.json();
      setEmailDraft(draft);

      // Open the pre-filled draft in the user's default mail client.
      const a = document.createElement("a");
      a.href = draft.mailto_url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to draft support email:", err);
      throw err;
    } finally {
      setIsDrafting(false);
    }
  }, [diagnosticsRef, form]);

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
    emailDraft,
    startCollection,
    downloadZip,
    draftSupportEmail,
    copyEmailBody,
    reset,
  };
}
