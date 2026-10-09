// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Typography } from "@tenstorrent/vesper/typography";
import { TextArea } from "@tenstorrent/vesper/text-area";
import { TextInput } from "@tenstorrent/vesper/text-input";
import {
  type ReactNode,
  type SubmitEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@tenstorrent/vesper/button";
import {
  Checkmark,
  Copy,
  Download,
  Reset,
  SocialGitHub,
  Spinner,
  SuccessSolid,
} from "@tenstorrent/vesper/icons";
import { TextButton } from "@tenstorrent/vesper/text-button";
import {
  createDiagnosticsRef,
  createNewGitHubIssueUrl,
  getGitHubIssueBody,
  saveBlob,
} from "../utils";

export function BugReport() {
  // diagnostics ref
  const [diagnosticsRef, setDiagnosticsRef] = useState(createDiagnosticsRef);

  // form fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");

  const gitHubIssue = useMemo(() => {
    const body = getGitHubIssueBody({
      title,
      description,
      steps,
      expected,
      actual,
      diagnosticsRef,
    });
    const url = createNewGitHubIssueUrl(title, body);
    return { body, url };
  }, [title, description, steps, expected, actual, diagnosticsRef]);

  // log state
  const [fetchingLogs, setFetchingLogs] = useState(false);
  const [logs, setLogs] = useState<null | Blob>(null);
  const [error, setError] = useState<null | string>(null);
  const didFetchLogs = !fetchingLogs && logs !== null;

  const resetForm = useCallback(() => {
    setTitle("");
    setDescription("");
    setSteps("");
    setExpected("");
    setActual("");
    setFetchingLogs(false);
    setLogs(null);
    setError(null);
    setDiagnosticsRef(createDiagnosticsRef);
  }, []);

  const handleSubmit: SubmitEventHandler = useCallback(async (e) => {
    e.preventDefault();
    try {
      setError(null);
      setFetchingLogs(true);
      const response = await fetch("/logs-api/bug-report/download/");
      if (!response.ok) {
        throw new Error(`Logs download failed: HTTP ${response.status}`);
      }
      setLogs(await response.blob());
    } catch {
      setLogs(null);
      setError(`Logs download failed`);
    } finally {
      setFetchingLogs(false);
    }
  }, []);

  const downloadLogs = useCallback(() => {
    if (logs === null) return;
    saveBlob(logs, diagnosticsRef);
  }, [logs, diagnosticsRef]);

  return (
    <form
      className="mt-vesper-8 flex flex-col gap-vesper-4"
      onSubmit={handleSubmit}
    >
      <BugReportStep>
        <BugReportStepTitle
          step={1}
          title="Describe"
          rightChild={
            didFetchLogs && (
              <SuccessSolid
                width={24}
                className="text-vesper-icon-success ml-auto"
              />
            )
          }
        />
        {!fetchingLogs && !didFetchLogs && (
          <div className="flex flex-col gap-vesper-5">
            <BugReportField title="Issue Title*">
              <TextInput
                name="title"
                required
                placeholder="Issue title"
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </BugReportField>
            <BugReportField title="Description*">
              <TextArea
                name="description"
                required
                placeholder="Brief summary of the bug"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </BugReportField>
            <BugReportField title="Steps to reproduce*">
              <TextArea
                name="steps"
                required
                placeholder={`...1\n...2\n...3`}
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
              />
            </BugReportField>
            <BugReportField title="Expected behavior (optional)">
              <TextArea
                name="expected"
                placeholder="What should have happened?"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </BugReportField>
            <BugReportField title="Actual behavior (optional)">
              <TextArea
                name="actual"
                placeholder="What actually happened?"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
              />
            </BugReportField>
          </div>
        )}
        {!didFetchLogs && (
          <Button
            className="w-full"
            type="submit"
            disabled={fetchingLogs}
            iconLeft={fetchingLogs && <Spinner className="animate-spin" />}
          >
            {fetchingLogs ? "Collecting logs" : (error ?? "Save")}
          </Button>
        )}
      </BugReportStep>
      <BugReportStep>
        <BugReportStepTitle
          step={2}
          title="Submit"
          rightChild={
            didFetchLogs && <CopyToClipboardButton text={gitHubIssue.body} />
          }
        />
        {didFetchLogs && (
          <div className="flex flex-col gap-vesper-4">
            <div className="bg-vesper-tint-neutral-100 border border-vesper-border-tertiary p-vesper-4 flex flex-col gap-vesper-6 rounded-vesper-3">
              <Typography variant="copy-sm">
                1. Download Logs as a ZIP. You will attach this to your GitHub
                issue
              </Typography>
              <Button
                variant="contrast"
                iconLeft={<Download />}
                type="button"
                size="sm"
                onClick={downloadLogs}
              >
                Download .ZIP
              </Button>
            </div>
            <div className="bg-vesper-tint-neutral-100 border border-vesper-border-tertiary p-vesper-4 flex flex-col gap-vesper-6 rounded-vesper-3">
              <Typography variant="copy-sm">
                2. Create a GitHub issue. Information from the last step will be
                populated, attach the .ZIP file.
              </Typography>
              <Button
                as="a"
                href={gitHubIssue.url}
                target="_blank"
                rel="noopener noreferrer"
                variant="contrast"
                iconLeft={<SocialGitHub />}
                type="button"
                size="sm"
              >
                Create GitHub issue
              </Button>
            </div>
          </div>
        )}
        {didFetchLogs && (
          <div className="flex justify-end">
            <Button
              variant="subtle"
              iconLeft={<Reset />}
              type="button"
              onClick={resetForm}
            >
              Start over
            </Button>
          </div>
        )}
      </BugReportStep>
    </form>
  );
}

function CopyToClipboardButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => clearTimeout(timeout.current), []);

  return (
    <TextButton
      iconLeft={copied ? <Checkmark /> : <Copy />}
      className="ml-auto"
      variant="subtle"
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        timeout.current = setTimeout(() => setCopied(false), 3000);
      }}
    >
      {copied ? "Report copied to clipboard" : "copy report to clipboard"}
    </TextButton>
  );
}

function BugReportStep({ children }: { children: ReactNode }) {
  return (
    <div className="border border-vesper-border-secondary bg-vesper-tint-neutral-100 p-vesper-5 text-left text-vesper-text-primary rounded-vesper-2">
      <div className="flex flex-col gap-vesper-8">{children}</div>
    </div>
  );
}

function BugReportStepTitle({
  step,
  title,
  rightChild,
}: {
  step: number;
  title: string;
  rightChild?: ReactNode;
}) {
  return (
    <Typography
      as="h3"
      variant="label-md-bold"
      className="flex items-center gap-vesper-2"
    >
      <Typography
        as="span"
        variant="label-sm-mono"
        className="w-6 h-6 flex items-center justify-center bg-vesper-tint-neutral-200 rounded-full"
      >
        {step}
      </Typography>
      {title}
      {rightChild}
    </Typography>
  );
}

function BugReportField({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-vesper-2">
      <Typography className="text-vesper-text-secondary" variant="label-xs">
        {title}
      </Typography>
      {children}
    </label>
  );
}
