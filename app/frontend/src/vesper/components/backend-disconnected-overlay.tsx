// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type React from "react";
import { createPortal } from "react-dom";
import { Button } from "@tenstorrent/vesper/button";
import { Code } from "@tenstorrent/vesper/code";
import { Error, Spinner } from "@tenstorrent/vesper/icons";
import { Typography } from "@tenstorrent/vesper/typography";
import type { BackendStatus } from "@/src/contexts/BackendHealthContext";

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
      className="fixed inset-0 flex items-center justify-center bg-vesper-dot-pattern-secondary text-vesper-text-primary"
      style={{ zIndex: OVERLAY_Z_INDEX }}
    >
      <div className="w-full max-w-md rounded-lg border border-vesper-border-primary bg-vesper-background-primary">
        <div className="flex flex-col items-center text-center">
          <div className="flex flex-col items-center p-vesper-6 gap-vesper-6">
            <div className="w-10 h-10 flex items-center justify-center bg-vesper-background-error-subtle rounded-vesper-2">
              <Error className="h-7 w-7 text-vesper-icon-error" />
            </div>
            <div className="flex flex-col items-center gap-vesper-2">
              <Typography
                as="h2"
                id="backend-disconnected-title"
                variant="heading-md"
              >
                Not connected to the backend
              </Typography>
              <Typography className="text-vesper-text-secondary">
                TT-Studio has lost connection to its backend service. The app is
                paused until the connection is restored.
              </Typography>
            </div>
          </div>

          <div className="px-vesper-6 py-vesper-4">
            <Typography
              as="div"
              className="rounded-vesper-2 p-vesper-4 text-vesper-text-secondary bg-vesper-tint-neutral-200 text-left"
            >
              <p>Try this:</p>
              <ul className="list-disc pl-vesper-4 mt-vesper-4">
                <li>
                  Restart the application with <Code>python run.py</Code>.
                </li>
                <li>Confirm the host machine is powered on and reachable.</li>
                <li>
                  If you're connected over SSH, check that the port forward is
                  still active.
                </li>
              </ul>
            </Typography>
          </div>

          <div className="p-vesper-6 w-full">
            <Button
              type="button"
              onClick={onRetry}
              disabled={isChecking}
              className="w-full"
              size="lg"
              variant="contrast"
              iconLeft={isChecking && <Spinner className="animate-spin" />}
            >
              {isChecking ? "Checking..." : "Check again"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(overlay, document.body)
    : overlay;
};
