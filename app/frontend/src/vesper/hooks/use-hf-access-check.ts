// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import {
  HfCheckResult,
  HfCheckStatus,
  runHfCheck,
} from "@/src/api/settingsApi";

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
    label: "FLUX.1-dev",
    repo: "black-forest-labs/FLUX.1-dev",
    status: "no_token" as HfCheckStatus,
    url: "https://huggingface.co/black-forest-labs/FLUX.1-dev",
  },
];

export interface HFAccessCheck {
  results: HfCheckResult[];
  error: string | null;
  runCheck: () => Promise<void>;
  isChecking: boolean;
  hasChecked: boolean;
  allGranted: boolean;
}

export function useHFAccessCheck(hfToken: string): HFAccessCheck {
  const [results, setResults] = useState<HfCheckResult[]>(
    GATED_MODELS_PLACEHOLDER
  );
  const [isChecking, setIsChecking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [allGranted, setAllGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setIsChecking(true);
    setError(null);
    try {
      const resp = await runHfCheck(hfToken);
      setResults(resp.results);
      setHasChecked(true);
      if (resp.error) setError(resp.error);
      setAllGranted(resp.ok);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Check failed");
      // Surface the failed attempt to the parent so a transient network error
      // doesn't dead-end the Welcome flow with a permanently-disabled Continue.
      setHasChecked(true);
      setAllGranted(false);
    } finally {
      setIsChecking(false);
    }
  };

  return { results, error, runCheck, isChecking, hasChecked, allGranted };
}
