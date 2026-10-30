// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import {
  getStackUpdatePolicy,
  setStackUpdatePolicy,
  type StackUpdatePolicy,
} from "../lib/ipc";

const LABELS: Record<StackUpdatePolicy, string> = {
  auto: "update automatically",
  prompt: "ask first",
  never: "never update",
};

/**
 * The stack-refresh policy control: what to do when a connect target's
 * checkout is behind the latest release. Stored with the app settings.
 */
function StackUpdateSetting() {
  const [policy, setPolicy] = useState<StackUpdatePolicy | null>(null);

  useEffect(() => {
    getStackUpdatePolicy()
      .then(setPolicy)
      .catch(() => setPolicy("prompt"));
  }, []);

  if (!policy) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-500">
      Stack updates:
      <select
        data-testid="stack-update-policy"
        value={policy}
        onChange={(e) => {
          const next = e.target.value as StackUpdatePolicy;
          setPolicy(next);
          setStackUpdatePolicy(next).catch(() => {});
        }}
        className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300"
      >
        {(Object.keys(LABELS) as StackUpdatePolicy[]).map((value) => (
          <option key={value} value={value}>
            {LABELS[value]}
          </option>
        ))}
      </select>
    </label>
  );
}

export default StackUpdateSetting;
