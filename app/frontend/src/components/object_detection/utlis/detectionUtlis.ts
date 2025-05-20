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
    let mediaEl: HTMLImageElement | HTMLVideoElement | null = null;
    let naturalWidth = 0;
    let naturalHeight = 0;

    // Find the media element (video or image)
    if (videoRef?.current) {
      mediaEl = videoRef.current;
      naturalWidth = mediaEl.videoWidth;
      naturalHeight = mediaEl.videoHeight;
      if (naturalWidth === 0 || naturalHeight === 0) {
        return detections;
      }
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
      naturalWidth = metadata.width;
      naturalHeight = metadata.height;
    }

    // For images, use the displayed image size and no offset
    if (!videoRef?.current && mediaEl instanceof HTMLImageElement) {
      const displayWidth = mediaEl.width;
      const displayHeight = mediaEl.height;
      return detections.map((detection) => {
        return {
          ...detection,
          scaledXmin: detection.xmin * displayWidth,
          scaledYmin: detection.ymin * displayHeight,
          scaledWidth: (detection.xmax - detection.xmin) * displayWidth,
          scaledHeight: (detection.ymax - detection.ymin) * displayHeight,
        };
      });
    }

    // For video, use container and offset logic
    const containerRect = containerEl.getBoundingClientRect();
    let mediaRect: DOMRect | null = null;
    if (mediaEl) {
      mediaRect = mediaEl.getBoundingClientRect();
    }
    let displayWidth = 0,
      displayHeight = 0,
      offsetX = 0,
      offsetY = 0;
    if (mediaRect) {
      displayWidth = mediaRect.width;
      displayHeight = mediaRect.height;
      offsetX = mediaRect.left - containerRect.left;
      offsetY = mediaRect.top - containerRect.top;
    } else {
      // Fallback: fit media into container by aspect ratio
      const containerAspect = containerRect.width / containerRect.height;
      const mediaAspect = naturalWidth / naturalHeight;
      if (mediaAspect > containerAspect) {
        displayWidth = containerRect.width;
        displayHeight = displayWidth / mediaAspect;
      } else {
        displayHeight = containerRect.height;
        displayWidth = displayHeight * mediaAspect;
      }
      offsetX = (containerRect.width - displayWidth) / 2;
      offsetY = (containerRect.height - displayHeight) / 2;
    }
    return detections.map((detection) => {
      return {
        ...detection,
        scaledXmin: detection.xmin * displayWidth + offsetX,
        scaledYmin: detection.ymin * displayHeight + offsetY,
        scaledWidth: (detection.xmax - detection.xmin) * displayWidth,
        scaledHeight: (detection.ymax - detection.ymin) * displayHeight,
      };
    });
  } catch (error) {
    console.error("Error updating box positions:", error);
    return detections;
  }
};
