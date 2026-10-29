// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Chip } from "@tenstorrent/vesper/icons";
import { Typography } from "@tenstorrent/vesper/typography";
import { ThemeSwitcher } from "@tenstorrent/vesper/theme-switcher";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { cn } from "@/src/lib/utils";
import { useDeviceState } from "@/src/hooks/useDeviceState";
import { ResetHardwareModal } from "@/src/vesper/components/reset-hardware-modal";

/** What the reset button's dot says about the board, if anything. */
function useBoardAlert(): { label: string; tone: "error" | "progress" } | null {
  const { deviceState } = useDeviceState();
  switch (deviceState?.state) {
    case "BAD_STATE":
      return { label: "The board isn't responding", tone: "error" };
    case "NOT_PRESENT":
      return { label: "No Tenstorrent device detected", tone: "error" };
    case "RESETTING":
      return { label: "A board reset is in progress", tone: "progress" };
    default:
      return null;
  }
}

export function Header({ title }: { title?: string }) {
  const [resetOpen, setResetOpen] = useState(false);
  const alert = useBoardAlert();
  const resetLabel = alert
    ? `Reset hardware: ${alert.label}`
    : "Reset hardware";

  return (
    <div className="px-vesper-6 py-vesper-4 h-16 border-b border-b-vesper-border-tertiary flex items-center gap-vesper-6 bg-vesper-background-primary">
      {title && (
        <Typography className="text-vesper-text-primary" variant="heading-sm">
          {title}
        </Typography>
      )}
      <div className="ml-auto flex items-center gap-vesper-8">
        <span className="relative inline-flex">
          <Tooltip content={resetLabel} side="bottom">
            <IconButton
              type="button"
              size="sm"
              variant="subtle"
              icon={<Chip />}
              aria-label={resetLabel}
              onClick={() => setResetOpen(true)}
            />
          </Tooltip>
          {alert && (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute top-0.5 right-0.5 w-2 h-2 rounded-full",
                alert.tone === "error"
                  ? "bg-vesper-background-error-base"
                  : "bg-vesper-background-warning-base animate-pulse"
              )}
            />
          )}
        </span>
        <ThemeSwitcher />
      </div>
      <ResetHardwareModal open={resetOpen} onOpenChange={setResetOpen} />
    </div>
  );
}
