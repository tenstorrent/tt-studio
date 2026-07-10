// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type React from "react";
import { createPortal } from "react-dom";
import { ServerCrash, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import type { BackendStatus } from "../contexts/BackendHealthContext";

// Sit above the toaster (z-index 99999) so any lingering per-feature error
// toasts are covered by the screen rather than showing through it.
const OVERLAY_Z_INDEX = 100000;

interface BackendDisconnectedOverlayProps {
  status: BackendStatus;
  onRetry: () => void;
}

export const BackendDisconnectedOverlay: React.FC<
  BackendDisconnectedOverlayProps
> = ({ status, onRetry }) => {
  const isChecking = status === "checking";

  // Fully opaque, full-screen wrapper. The rest of the app is unmounted while
  // this is shown, so it stands in for the whole UI rather than layering over it.
  const overlay = (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="backend-disconnected-title"
      className="fixed inset-0 flex items-center justify-center bg-background p-4 text-foreground"
      style={{ zIndex: OVERLAY_Z_INDEX }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ServerCrash className="h-7 w-7" />
          </div>

          <h2
            id="backend-disconnected-title"
            className="text-xl font-semibold"
          >
            Not connected to the backend
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            TT-Studio has lost connection to its backend service. The app is
            paused until the connection is restored.
          </p>

          <div className="mt-5 w-full rounded-md border border-border bg-muted/40 p-4 text-left text-sm text-muted-foreground">
            <p className="mb-2 font-medium text-foreground">Try this:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                Restart the application with{" "}
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
