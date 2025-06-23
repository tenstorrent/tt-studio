// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import axios from "axios";
import { Detection, DetectionMetadata } from "../types/objectDetection";
import { InferenceRequest } from "../types/objectDetection";

export const runInference = async (
  request: InferenceRequest,
  imageSourceElement: HTMLCanvasElement | HTMLImageElement,
  setDetections: (data: { boxes: Detection[]; metadata: DetectionMetadata }) => void
) => {
  // construct FormData to send to API
  const formData = new FormData();
  formData.append("deploy_id", request.deploy_id ?? "null");
  // handle Blob and File image sources
  if (request.imageSource instanceof Blob) {
    formData.append("image", request.imageSource, "canvas-image.jpg");
  } else {
    formData.append("image", request.imageSource);
  }

  try {
    const startTime = performance.now();
    const apiUrlDefined = import.meta.env.VITE_ENABLE_DEPLOYED === "true";
    const useCloudEndpoint =
      request.deploy_id === null || request.deploy_id === "null" || apiUrlDefined;

    const API_URL = useCloudEndpoint
      ? "/models-api/object-detection-cloud/"
      : "/models-api/object-detection/";

    const response = await axios.post(API_URL, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    const endTime = performance.now();
    const requestLatency = endTime - startTime;
    // handle imageSourceElement types
    let width, height;
    if (imageSourceElement instanceof HTMLCanvasElement) {
      width = imageSourceElement.width;
      height = imageSourceElement.height;
    } else {
      width = imageSourceElement.naturalWidth;
      height = imageSourceElement.naturalHeight;
    }
    const detectionMetadata: DetectionMetadata = {
      width: width,
      height: height,
      inferenceTime: response.data.inference_time || (1 / (requestLatency / 1000)).toFixed(2),
    };
    const detections: Detection[] = response.data.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item: any) => {
        const [xmin, ymin, xmax, ymax, confidence, classId, className] = item;
        const detection: Detection = {
          xmin,
          ymin,
          xmax,
          ymax,
          confidence,
          class: classId,
          name: className,
        };
        return detection;
      }
    );
    setDetections({ boxes: detections, metadata: detectionMetadata });
  } catch (error) {
    console.error("Error sending snapshot:", error);
    throw error;
  }
};