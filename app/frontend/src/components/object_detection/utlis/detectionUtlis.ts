// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { Detection, DetectionMetadata } from "../types/objectDetection";

export const updateBoxPositions = (
  containerRef: React.RefObject<HTMLDivElement>,
  videoRef: React.RefObject<HTMLVideoElement> | null,
  metadata: DetectionMetadata | null,
  detections: Detection[]
): Detection[] => {
  if (!containerRef.current || !metadata) return detections;

  try {
    const containerEl = containerRef.current;

    // Step 1: Find the actual media element (image or video)
    let mediaEl: HTMLImageElement | HTMLVideoElement | null = null;
    let mediaRect: DOMRect | null = null;
    let naturalWidth = 0;
    let naturalHeight = 0;

    if (videoRef?.current) {
      mediaEl = videoRef.current;
      naturalWidth = mediaEl.videoWidth;
      naturalHeight = mediaEl.videoHeight;
    } else {
      const imgEl = containerEl.querySelector("img");
      if (imgEl) {
        mediaEl = imgEl;
        naturalWidth = imgEl.naturalWidth;
        naturalHeight = imgEl.naturalHeight;
      }
    }

    if (!mediaEl) {
      // Fallback to container if no media element found
      mediaRect = containerEl.getBoundingClientRect();
      naturalWidth = metadata.width;
      naturalHeight = metadata.height;
    } else {
      mediaRect = mediaEl.getBoundingClientRect();
    }

    // Step 2: Get the container's dimensions and position
    const containerRect = containerEl.getBoundingClientRect();

    // Step 3: Calculate the media element's position relative to its container
    const mediaOffsetX = mediaRect.left - containerRect.left;
    const mediaOffsetY = mediaRect.top - containerRect.top;

    // Step 4: Calculate the scale factor between natural media size and displayed size
    // This maintains the aspect ratio of the bounding boxes
    const mediaScaleX = mediaRect.width / naturalWidth;
    const mediaScaleY = mediaRect.height / naturalHeight;

    // Step 5: Map detection coordinates to pixels
    return detections.map((detection) => {
      // Convert from normalized coordinates (0-1) to actual pixel positions
      const boxLeft =
        detection.xmin * naturalWidth * mediaScaleX + mediaOffsetX;
      const boxTop =
        detection.ymin * naturalHeight * mediaScaleY + mediaOffsetY;
      const boxWidth =
        (detection.xmax - detection.xmin) * naturalWidth * mediaScaleX;
      const boxHeight =
        (detection.ymax - detection.ymin) * naturalHeight * mediaScaleY;

      return {
        ...detection,
        scaledXmin: boxLeft,
        scaledYmin: boxTop,
        scaledWidth: boxWidth,
        scaledHeight: boxHeight,
      };
    });
  } catch (error) {
    console.error("Error updating box positions:", error);
    return detections;
  }
};
