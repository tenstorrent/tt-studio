// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ModelQwenColor } from "@tenstorrent/vesper/icons";
import { Material } from "@tenstorrent/vesper/material";
import { Typography } from "@tenstorrent/vesper/typography";
import { Tag } from "@tenstorrent/vesper/tag";

export function SolutionCard() {
  return (
    <Material className="p-vesper-4 flex flex-col gap-vesper-5">
      <div className="flex items-center justify-between">
        <Tag>Text-to-Video</Tag>
        <Tag variant="accent-subtle">2 devices</Tag>
      </div>
      <div className="flex flex-col gap-vesper-2">
        <div className="flex items-center gap-vesper-2">
          <ModelQwenColor width={24} />
          <Typography
            variant="label-sm-mono"
            className="text-vesper-text-primary"
          >
            Wan 2.2 14B
          </Typography>
        </div>
        <Typography variant="copy-xs" className="text-vesper-text-tertiary">
          Causal video transformer for text-to-video with strong motion
          coherence. Alibaba, 14B.
        </Typography>
      </div>
    </Material>
  );
}
