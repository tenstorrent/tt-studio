// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

const SUPPORT_ROTATION = [
  { name: "Anirudh", email: "aramchandran@tenstorrent.com" },
  { name: "Jashan", email: "jashansingh@tenstorrent.com" },
  { name: "Raheem", email: "rnabeel@tenstorrent.com" },
] as const;

export function createNewGitHubIssueUrl(title: string, body: string) {
  const url = new URL("https://github.com/tenstorrent/tt-studio/issues/new");
  url.searchParams.set("title", title);
  url.searchParams.set("body", body);
  return url.toString();
}

export function getGitHubIssueBody(args: {
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  diagnosticsRef: string;
}) {
  return `Assignee: ${getCurrentSupportAssignee()}
Reference: ${args.diagnosticsRef}

TT-Studio bug report. Do not edit the Assignee/Reference lines — Jira automation reads them.
Logs: attach \`${getZipFileName(args.diagnosticsRef)}\` from your Downloads before sending.

## Summary
[TT-Studio] ${args.title} [${args.diagnosticsRef}]

## Description
${args.description}

## Steps to Reproduce
${args.steps}

## Expected Behavior
${args.expected || "What should have happened?"}

## Actual Behavior
${args.actual || "What actually happened?"}

--
Sent from TT-Studio bug-reporter.`;
}

export function createDiagnosticsRef(): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `ttbr-${suffix}`;
}

const getZipFileName = (ref: string) => `tt-studio-logs-${ref}.zip`;

/** Trigger a browser download of `blob` under `filename`. */
export function saveBlob(blob: Blob, diagnosticsRef: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = getZipFileName(diagnosticsRef);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getCurrentSupportAssignee(): string {
  const today = new Date();
  const isoDate = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  );
  const isoDay = isoDate.getUTCDay() || 7;
  isoDate.setUTCDate(isoDate.getUTCDate() + 4 - isoDay);
  const yearStart = new Date(Date.UTC(isoDate.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil(
    (1 + (isoDate.getTime() - yearStart.getTime()) / 86_400_000) / 7
  );
  const assignee = SUPPORT_ROTATION[isoWeek % SUPPORT_ROTATION.length];
  return `${assignee.name} <${assignee.email}>`;
}
