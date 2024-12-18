// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import axios from "axios";
import { Detection, DetectionMetadata } from "../types/objectDetection";

export const startCapture = (
  videoRef: React.RefObject<HTMLVideoElement>,
  setDetections: (data: {
    boxes: Detection[];
    metadata: DetectionMetadata;
  }) => void,
  setIsLoading: (isLoading: boolean) => void
) => {
  return new Promise<void>((resolve, reject) => {
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            setIsLoading(false);
            setDetections({
              boxes: [],
              metadata: { width: 0, height: 0, inferenceTime: 0 },
            });
            resolve();
          };
        }
      })
      .catch((error) => {
        console.error("Error accessing webcam:", error);
        setIsLoading(false);
        reject(error);
      });
  });
};

export const sendSnapshot = async (
  videoRef: React.RefObject<HTMLVideoElement>,
  setDetections: (data: {
    boxes: Detection[];
    metadata: DetectionMetadata;
  }) => void,
  modelID: string
) => {
  if (videoRef.current) {
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8)
    );
    if (!blob) {
      throw new Error("Failed to create blob from canvas");
    }

    const formData = new FormData();
    formData.append("image", blob, "canvas-image.jpg");
    formData.append("deploy_id", modelID);

    try {
      const response = await axios.post(
        `/models-api/object-detection/`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      );
      console.log(response.data);
      const detectionMetadata: DetectionMetadata = {
        width: canvas.width,
        height: canvas.height,
        inferenceTime: response.data.inference_time || 33.333,
      };
      console.log(detectionMetadata);
      const detections: Detection[] = response.data.map(
        (item: Array<number>) => {
          const [xmin, ymin, xmax, ymax, confidence, _, classId] = item;
          const detection: Detection = {
            xmin,
            ymin,
            xmax,
            ymax,
            confidence,
            class: classId,
            name: "DEFAULT_NAME", // Get the name from classNames array or default to "Unknown"
          };
          return detection;
        }
      );
      setDetections({ boxes: detections, metadata: detectionMetadata });
    } catch (error) {
      console.error("Error sending snapshot:", error);
      throw error;
    }
  }
};

export const stopCapture = (
  videoRef: React.RefObject<HTMLVideoElement> | null
) => {
  if (videoRef && videoRef.current && videoRef.current.srcObject) {
    const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
    tracks.forEach((track) => track.stop());
  }
};
