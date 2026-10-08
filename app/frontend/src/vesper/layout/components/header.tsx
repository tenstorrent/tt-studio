// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Typography } from "@tenstorrent/vesper/typography";
import { ThemeSwitcher } from "@tenstorrent/vesper/theme-switcher";

export function Header({ title }: { title?: string }) {
  return (
    <div className="px-vesper-6 py-vesper-4 h-16 border-b border-b-vesper-border-tertiary flex items-center gap-vesper-6 bg-vesper-background-primary">
      {title && (
        <Typography className="text-vesper-text-primary" variant="heading-sm">
          {title}
        </Typography>
      )}
      <ThemeSwitcher className="ml-auto" />
    </div>
  );
}
