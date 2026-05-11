// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ExternalLink, Loader2, X, AlertCircle } from "lucide-react";

import { Button } from "./ui/button";
import {
  runHfCheck,
  type HfCheckResult,
  type HfCheckStatus,
} from "../api/settingsApi";

interface Props {
  /** Optional token to test before saving; if omitted, server uses the stored token. */
  token?: string;
  /** Called once a check has run successfully (regardless of access outcome). */
  onChecked?: (allGranted: boolean, results: HfCheckResult[]) => void;
  className?: string;
}

const GATED_MODELS_PLACEHOLDER: HfCheckResult[] = [
  {
    label: "Llama 3.1",
    repo: "meta-llama/Llama-3.1-8B-Instruct",
    status: "no_token" as HfCheckStatus,
    url: "https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct",
  },
  {
    label: "Llama 3.3",
    repo: "meta-llama/Llama-3.3-70B-Instruct",
    status: "no_token" as HfCheckStatus,
    url: "https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct",
  },
  {
    label: "Qwen3-32B",
    repo: "Qwen/Qwen3-32B",
    status: "no_token" as HfCheckStatus,
    url: "https://huggingface.co/Qwen/Qwen3-32B",
  },
];

function StatusIcon({ status }: { status: HfCheckStatus }) {
  if (status === "granted") {
    return (
      <motion.div
        key="granted"
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="rounded-full bg-emerald-500/15 p-1.5"
      >
        <Check className="w-4 h-4 text-emerald-500" />
      </motion.div>
    );
  }
  if (status === "denied" || status === "auth_failed") {
    return (
      <motion.div
        key="denied"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="rounded-full bg-red-500/15 p-1.5"
      >
        <X className="w-4 h-4 text-red-500" />
      </motion.div>
    );
  }
  if (status === "no_token") {
    return (
      <div className="rounded-full bg-stone-500/15 p-1.5">
        <AlertCircle className="w-4 h-4 text-stone-400" />
      </div>
    );
  }
  return (
    <div className="rounded-full bg-amber-500/15 p-1.5">
      <AlertCircle className="w-4 h-4 text-amber-500" />
    </div>
  );
}

function statusLabel(r: HfCheckResult): string {
  switch (r.status) {
    case "granted":
      return "Access confirmed";
    case "denied":
      return "Access not granted yet";
    case "auth_failed":
      return "Token invalid or expired";
    case "no_token":
      return "No token saved";
    default:
      return `Could not reach Hugging Face${r.http_status ? ` (HTTP ${r.http_status})` : ""}`;
  }
}

export default function HfAccessCheck({ token, onChecked, className }: Props) {
  const [results, setResults] = useState<HfCheckResult[]>(GATED_MODELS_PLACEHOLDER);
  const [isChecking, setIsChecking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setIsChecking(true);
    setError(null);
    setResults((prev) =>
      prev.map((r) => ({ ...r, status: "no_token" as HfCheckStatus }))
    );
    try {
      const resp = await runHfCheck(token);
      setResults(resp.results);
      setHasChecked(true);
      if (resp.error) setError(resp.error);
      onChecked?.(resp.ok, resp.results);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Check failed");
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-sm font-medium">Hugging Face access</div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={runCheck}
          disabled={isChecking}
        >
          {isChecking ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Checking…
            </>
          ) : hasChecked ? (
            "Re-check"
          ) : (
            "Run check"
          )}
        </Button>
      </div>

      <ul className="space-y-2">
        {results.map((r) => (
          <li
            key={r.repo}
            className="flex items-center justify-between rounded-md border border-stone-200 dark:border-stone-800 px-3 py-2"
          >
            <div className="flex items-center gap-3 min-w-0">
              <AnimatePresence mode="popLayout">
                {isChecking ? (
                  <motion.div
                    key="spin"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="rounded-full bg-TT-purple/15 p-1.5"
                  >
                    <Loader2 className="w-4 h-4 text-TT-purple animate-spin" />
                  </motion.div>
                ) : (
                  <StatusIcon status={r.status} />
                )}
              </AnimatePresence>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{r.label}</div>
                <div className="text-xs text-stone-500 truncate">
                  {statusLabel(r)}
                </div>
              </div>
            </div>
            {(r.status === "denied" || r.status === "auth_failed") && (
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-TT-purple hover:underline whitespace-nowrap"
              >
                Request access <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p className="mt-2 text-xs text-red-500">{error}</p>
      )}
    </div>
  );
}
