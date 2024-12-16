// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
export interface Detection {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  confidence: number;
  class: number;
  name: string;
  scaledXmin?: number;
  scaledYmin?: number;
  scaledWidth?: number;
  scaledHeight?: number;
}

export interface DetectionMetadata {
  width: number;
  height: number;
  inferenceTime: number;
}
