// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { Detection, DetectionMetadata } from "../types/objectDetection";

export const updateBoxPositions = (
  containerRef: React.RefObject<HTMLDivElement>,
  videoRef: React.RefObject<HTMLVideoElement> | null,
  metadata: DetectionMetadata | null,
  detections: Detection[],
): Detection[] => {
  if (containerRef.current && metadata) {
    const containerRect = containerRef.current.getBoundingClientRect();

    const scaleX = containerRect.width / metadata.width;
    const scaleY = containerRect.height / metadata.height;

    return detections.map((detection) => ({
      ...detection,
      scaledXmin: detection.xmin * scaleX,
      scaledYmin: detection.ymin * scaleY,
      scaledWidth: (detection.xmax - detection.xmin) * scaleX,
      scaledHeight: (detection.ymax - detection.ymin) * scaleY,
    }));
  }
  return detections;
};
