// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import axios from "axios";
import { Detection, DetectionMetadata } from "../types/objectDetection";
import { InferenceRequest } from "../types/objectDetection";

// Import environment variables properly
const IMAGE_API_TOKEN = import.meta.env.VITE_IMAGE_API_TOKEN;

export const runInference = async (
  request: InferenceRequest,
  imageSourceElement: HTMLCanvasElement | HTMLImageElement,
  setDetections: (data: {
    boxes: Detection[];
    metadata: DetectionMetadata;
  }) => void,
) => {
  // construct FormData to send to API
  const formData = new FormData();
  formData.append("deploy_id", request.deploy_id);
  
  // handle Blob and File image sources
  if (request.imageSource instanceof Blob) {
    formData.append("file", request.imageSource, "canvas-image.jpg");
  } else {
    formData.append("file", request.imageSource);
  }
  
  try {
    const startTime = performance.now();
    
    // UPDATED: Use the local proxy instead of direct API URL
    const response = await axios.post(
      "/objdetection", // Use our Vite proxy path instead of direct URL
      formData,
      {
        headers: { 
          "Content-Type": "multipart/form-data",
          "Authorization": `Bearer ${IMAGE_API_TOKEN}`,
          "Accept": "application/json"
        },
        withCredentials: false
      }
    );
    
    console.log("API Response:", response.data);
    
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
      inferenceTime: response.data.inference_time || (1/(requestLatency/1000)).toFixed(2),
    };
    
    // Handle different response formats
    let detectionItems = [];
    if (Array.isArray(response.data)) {
      detectionItems = response.data;
    } else if (response.data && typeof response.data === 'object') {
      // Try common field names in detection APIs
      if (Array.isArray(response.data.detections)) {
        detectionItems = response.data.detections;
      } else if (Array.isArray(response.data.predictions)) {
        detectionItems = response.data.predictions;
      } else if (Array.isArray(response.data.results)) {
        detectionItems = response.data.results;
      }
    }
    
    if (detectionItems.length === 0) {
      console.warn("No detection data found in response");
    }
    
    const detections: Detection[] = detectionItems.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item: any) => {
        // Handle Array format
        if (Array.isArray(item)) {
          const [xmin, ymin, xmax, ymax, confidence, classId, className] = item;
          return {
            xmin,
            ymin,
            xmax,
            ymax,
            confidence,
            class: classId,
            name: className,
          };
        } 
        // Handle Object format
        else if (typeof item === 'object' && item !== null) {
          return {
            xmin: item.xmin || item.x1 || 0,
            ymin: item.ymin || item.y1 || 0,
            xmax: item.xmax || item.x2 || 0,
            ymax: item.ymax || item.y2 || 0,
            confidence: item.confidence || item.score || 0,
            class: item.class || item.class_id || 0,
            name: item.name || item.class_name || "object"
          };
        }
        // Fallback
        return {
          xmin: 0,
          ymin: 0,
          xmax: 0,
          ymax: 0,
          confidence: 0,
          class: 0,
          name: "unknown"
        };
      }
    );
    
    console.log(`Detected ${detections.length} objects`);
    setDetections({ boxes: detections, metadata: detectionMetadata });
    
  } catch (error) {
    console.error("Error sending snapshot:", error);
    // Add more detailed error logging for debugging
    if (axios.isAxiosError(error)) {
      console.error("API Error Details:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        headers: error.response?.headers,
        data: error.response?.data
      });
    }
    throw error;
  }
};