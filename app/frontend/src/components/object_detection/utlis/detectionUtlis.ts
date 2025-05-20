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
    
    // Special handling for webcam video
    if (videoRef?.current) {
      mediaEl = videoRef.current;
      naturalWidth = mediaEl.videoWidth;
      naturalHeight = mediaEl.videoHeight;
      
      // If video dimensions are not ready yet, return unscaled detections
      if (naturalWidth === 0 || naturalHeight === 0) {
        return detections;
      }
      
      // Get DOM rectangles
      mediaRect = mediaEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      
      // Calculate the effective displayed dimensions of the video
      // This handles the object-contain scaling that the browser applies
      const containerAspect = containerRect.width / containerRect.height;
      const videoAspect = naturalWidth / naturalHeight;
      
      let displayWidth, displayHeight;
      
      if (videoAspect > containerAspect) {
        // Video is wider than container, so it's constrained by width
        displayWidth = mediaRect.width;
        displayHeight = displayWidth / videoAspect;
      } else {
        // Video is taller than container, so it's constrained by height
        displayHeight = mediaRect.height;
        displayWidth = displayHeight * videoAspect;
      }
      
      // Calculate the black bars (letterboxing/pillarboxing)
      const horizontalOffset = (mediaRect.width - displayWidth) / 2;
      const verticalOffset = (mediaRect.height - displayHeight) / 2;
      
      // Apply the calculated dimensions to the bounding boxes
      return detections.map((detection) => {
        const boxLeft = (detection.xmin * displayWidth) + horizontalOffset;
        const boxTop = (detection.ymin * displayHeight) + verticalOffset;
        const boxWidth = (detection.xmax - detection.xmin) * displayWidth;
        const boxHeight = (detection.ymax - detection.ymin) * displayHeight;
        
        return {
          ...detection,
          scaledXmin: boxLeft,
          scaledYmin: boxTop,
          scaledWidth: boxWidth,
          scaledHeight: boxHeight,
        };
      });
    } 
    else {
      // Original code for images
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
    
    // Determine if this is a portrait image (height > width)
    const isPortrait = naturalHeight > naturalWidth;
    
    // Step 4: Calculate the scale factor between natural media size and displayed size
    const mediaScaleX = mediaRect.width / naturalWidth;
    const mediaScaleY = mediaRect.height / naturalHeight;
    
    // Step 5: Map detection coordinates to pixels
    return detections.map((detection) => {
      // Convert from normalized coordinates (0-1) to actual pixel positions
      let boxLeft = detection.xmin * naturalWidth * mediaScaleX + mediaOffsetX;
      let boxTop = detection.ymin * naturalHeight * mediaScaleY + mediaOffsetY;
      const boxWidth = (detection.xmax - detection.xmin) * naturalWidth * mediaScaleX;
      const boxHeight = (detection.ymax - detection.ymin) * naturalHeight * mediaScaleY;
      
      // **Adjust for Landscape Images**
      if (!isPortrait) {
        // Fix for landscape images:
        // 1. Adjust for the image's vertical offset
        // 2. Ensure the vertical scale and offset don't fall too low.
        const imageVerticalOffset = (mediaRect.height - naturalHeight * mediaScaleY) / 2;
        boxTop = boxTop - mediaOffsetY + imageVerticalOffset; // Adjust top to align properly
      }
      
      // Apply correction for portrait images - explicitly account for the centering offset
      if (isPortrait) {
        // Apply a correction to boxLeft for vertical images
        // This is directly based on the observed offset we've seen in debugging
        boxLeft = boxLeft - mediaOffsetX;
      }
      
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