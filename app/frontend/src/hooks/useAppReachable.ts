// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";

export type Reachability = "checking" | "reachable" | "unreachable";

const PROBE_TIMEOUT_MS = 5000;

/**
 * Whether the browser itself can reach a launched app.
 *
 * The backend only knows the app answers on the Docker host. When TT-Studio runs
 * on a remote machine, the app's port usually isn't forwarded to the user's
 * browser, so "running" and "openable" are different questions and only the
 * browser can answer the second one.
 *
 * A no-cors probe resolves opaquely for any HTTP answer and rejects when the
 * connection fails, which is exactly the distinction needed here.
 */
export function useAppReachable(url: string | null): Reachability {
  const [state, setState] = useState<Reachability>("checking");

  useEffect(() => {
    if (!url) {
      setState("checking");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    fetch(url, { mode: "no-cors", cache: "no-store", signal: controller.signal })
      .then(() => !cancelled && setState("reachable"))
      .catch(() => !cancelled && setState("unreachable"))
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [url]);

  return state;
}
