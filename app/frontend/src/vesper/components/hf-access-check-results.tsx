// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Typography } from "@tenstorrent/vesper/typography";
import { Button } from "@tenstorrent/vesper/button";
import { TextButton } from "@tenstorrent/vesper/text-button";
import {
  ArrowUpRight,
  Checkmark,
  Error,
  Info,
  Warning,
} from "@tenstorrent/vesper/icons";
import { HfCheckResult, HfCheckStatus } from "@/src/api/settingsApi";
import { Spinner } from "@tenstorrent/vesper/icons";

export function HFAccessCheckResults({
  error,
  isChecking,
  results,
  runCheck,
}: {
  error: null | string;
  isChecking: boolean;
  results: HfCheckResult[];
  runCheck(): Promise<void>;
}) {
  return (
    <div className="w-full flex flex-col gap-vesper-4">
      <div className="flex justify-between items-center">
        <Typography className="text-vesper-text-primary">
          Model access
        </Typography>
        <Button
          size="xs"
          variant="tertiary"
          iconLeft={isChecking && <Spinner className="animate-spin" />}
          type="button"
          onClick={runCheck}
          disabled={isChecking}
        >
          {isChecking ? "Checking" : "Re-check"}
        </Button>
      </div>
      <ul className="flex flex-col gap-vesper-2">
        {results.map((result) => {
          return (
            <li
              key={result.repo}
              className="px-vesper-4 py-vesper-3 rounded-vesper-1 flex gap-vesper-3 border border-vesper-border-primary bg-vesper-background-primary items-center"
            >
              <StatusIcon isChecking={isChecking} status={result.status} />
              <div className="flex flex-col gap-vesper-1 items-start flex-1">
                <Typography
                  variant="copy-sm-bold"
                  className="text-vesper-text-primary"
                >
                  {result.label}
                </Typography>
                <Typography
                  variant="copy-xs"
                  className="text-vesper-text-secondary"
                >
                  {result.status === "granted" ? "Confirmed" : "Needs access"}
                </Typography>
              </div>
              {(result.status === "denied" ||
                result.status === "auth_failed") && (
                <TextButton
                  as="a"
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  variant="subtle"
                  iconRight={<ArrowUpRight />}
                >
                  Request access
                </TextButton>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <Typography
          variant="copy-xs"
          className="text-vesper-text-error text-left"
        >
          {error}
        </Typography>
      )}
    </div>
  );
}

function StatusIcon({
  status,
  isChecking,
}: {
  status: HfCheckStatus;
  isChecking: boolean;
}) {
  if (isChecking) {
    return (
      <div className="w-10 h-10 rounded-vesper-2 flex items-center justify-center bg-vesper-tint-contrast-100">
        <Spinner className="w-7 h-7 text-vesper-icon-tertiary animate-spin" />
      </div>
    );
  }
  if (status === "granted") {
    return (
      <div className="w-10 h-10 rounded-vesper-2 flex items-center justify-center bg-vesper-background-success-subtle">
        <Checkmark className="w-7 h-7 text-vesper-icon-success" />
      </div>
    );
  }
  if (status === "denied" || status === "auth_failed") {
    return (
      <div className="w-10 h-10 rounded-vesper-2 flex items-center justify-center bg-vesper-background-error-subtle">
        <Error className="w-7 h-7 text-vesper-icon-error" />
      </div>
    );
  }
  if (status === "no_token") {
    return (
      <div className="w-10 h-10 rounded-vesper-2 flex items-center justify-center bg-vesper-tint-contrast-100">
        <Info className="w-7 h-7 text-vesper-icon-tertiary" />
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-vesper-2 flex items-center justify-center bg-vesper-background-warning-subtle">
      <Warning className="w-7 h-7 text-vesper-icon-warning" />
    </div>
  );
}
