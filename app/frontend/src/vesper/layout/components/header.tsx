// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Chip } from "@tenstorrent/vesper/icons";
import { Typography } from "@tenstorrent/vesper/typography";
import { ThemeSwitcher } from "@tenstorrent/vesper/theme-switcher";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { ResetHardwareModal } from "@/src/vesper/components/reset-hardware-modal";

export function Header({ title }: { title?: string }) {
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <div className="px-vesper-6 py-vesper-4 h-16 border-b border-b-vesper-border-tertiary flex items-center gap-vesper-6 bg-vesper-background-primary">
      {title && (
        <Typography className="text-vesper-text-primary" variant="heading-sm">
          {title}
        </Typography>
      )}
      <div className="ml-auto flex items-center gap-vesper-8">
        <Tooltip content="Reset hardware" side="bottom">
          <IconButton
            type="button"
            size="sm"
            variant="subtle"
            icon={<Chip />}
            aria-label="Reset hardware"
            onClick={() => setResetOpen(true)}
          />
        </Tooltip>
        <ThemeSwitcher />
      </div>
      <ResetHardwareModal open={resetOpen} onOpenChange={setResetOpen} />
    </div>
  );
}
