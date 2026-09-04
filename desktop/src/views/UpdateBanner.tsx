// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useState } from "react";
import { checkShellUpdate, type ShellUpdate } from "../lib/updates";

type Phase =
  | { name: "idle" }
  | { name: "checking" }
  | { name: "current" }
  | { name: "available"; update: ShellUpdate }
  | { name: "installing"; update: ShellUpdate }
  | { name: "error"; message: string };

/**
 * Shell self-update strip for the connection picker: checks the release feed
 * once on launch (silently — offline must not get in the way of connecting)
 * and offers a manual "Check for updates" whose failures are shown.
 */
function UpdateBanner({
  checkUpdate = checkShellUpdate,
}: {
  checkUpdate?: () => Promise<ShellUpdate | null>;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  const runCheck = useCallback(
    (manual: boolean) => {
      setPhase({ name: "checking" });
      checkUpdate()
        .then((update) =>
          setPhase(update ? { name: "available", update } : { name: "current" }),
        )
        .catch((e) =>
          setPhase(
            manual
              ? { name: "error", message: String(e) }
              : { name: "idle" },
          ),
        );
    },
    [checkUpdate],
  );

  useEffect(() => {
    runCheck(false);
  }, [runCheck]);

  const install = useCallback(() => {
    if (phase.name !== "available") return;
    const update = phase.update;
    setPhase({ name: "installing", update });
    // On success the app relaunches; only the failure path renders.
    update.install().catch((e) => {
      setPhase({ name: "error", message: String(e) });
    });
  }, [phase]);

  if (phase.name === "available" || phase.name === "installing") {
    const installing = phase.name === "installing";
    return (
      <div
        data-testid="update-banner"
        className="flex items-center justify-between gap-3 rounded-md border border-sky-900 bg-sky-950/40 px-3 py-2 text-sm"
      >
        <span className="text-sky-200">
          TT-Studio {phase.update.version} is available.
        </span>
        <button
          type="button"
          data-testid="update-install"
          onClick={install}
          disabled={installing}
          className="rounded-md bg-sky-700 px-3 py-1 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-60"
        >
          {installing ? "Installing…" : "Install and restart"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-xs text-zinc-500">
      <button
        type="button"
        data-testid="update-check"
        onClick={() => runCheck(true)}
        disabled={phase.name === "checking"}
        className="rounded-md border border-zinc-800 px-2 py-1 hover:bg-zinc-900 disabled:opacity-60"
      >
        {phase.name === "checking" ? "Checking…" : "Check for updates"}
      </button>
      {phase.name === "current" && (
        <span data-testid="update-current">You're on the latest version.</span>
      )}
      {phase.name === "error" && (
        <span data-testid="update-error" className="text-amber-400">
          Couldn't check for updates: {phase.message}
        </span>
      )}
    </div>
  );
}

export default UpdateBanner;
