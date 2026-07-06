// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type React from "react";
import { createPortal } from "react-dom";
import { ServerCrash, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import type { BackendStatus } from "../contexts/BackendHealthContext";

// Sit above the toaster (z-index 99999) so stray per-feature error toasts are
// covered by the overlay rather than competing with it.
const OVERLAY_Z_INDEX = 100000;

interface BackendDisconnectedOverlayProps {
  status: BackendStatus;
  onRetry: () => void;
}

export const BackendDisconnectedOverlay: React.FC<
  BackendDisconnectedOverlayProps
> = ({ status, onRetry }) => {
  const isChecking = status === "checking";

  const overlay = (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="backend-disconnected-title"
      className="fixed inset-0 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      style={{ zIndex: OVERLAY_Z_INDEX }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-8 text-foreground shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ServerCrash className="h-7 w-7" />
          </div>

          <h2
            id="backend-disconnected-title"
            className="text-xl font-semibold"
          >
            Backend disconnected
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            TT-Studio can't reach its backend service, so the app can't load or
            run anything right now.
          </p>

          <div className="mt-5 w-full rounded-md border border-border bg-muted/40 p-4 text-left text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">Try this:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                Restart the service with{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                  python run.py
                </code>
                .
              </li>
              <li>Confirm the host machine is powered on and reachable.</li>
              <li>
                If you're connected over SSH, check that the port forward is
                still active.
              </li>
            </ul>
          </div>

          <Button
            type="button"
            onClick={onRetry}
            disabled={isChecking}
            className="mt-6 w-full"
          >
            {isChecking ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Checking…
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry now
              </>
            )}
          </Button>

          <p className="mt-3 text-xs text-muted-foreground">
            This screen clears automatically once the backend is back.
          </p>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(overlay, document.body)
    : overlay;
};
