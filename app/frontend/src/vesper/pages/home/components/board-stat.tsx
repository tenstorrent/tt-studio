// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Typography } from "@tenstorrent/vesper/typography";
import { ProgressBar } from "@tenstorrent/vesper/progress-bar";

export interface BoardStatProps {
  name: string;
  value: number;
  valueText: string;
};

export function BoardStat({ name, value, valueText }: BoardStatProps) {
  return (
    <div className="flex flex-col gap-vesper-2">
      <div className="flex items-center justify-between">
        <Typography
          variant="label-xs"
          className="text-vesper-text-secondary uppercase"
        >
          {name}
        </Typography>
        <Typography
          variant="label-xs-mono"
          className="text-vesper-text-primary"
        >
          {valueText}
        </Typography>
      </div>
      <ProgressBar animated size="sm" value={value} />
    </div>
  );
}
