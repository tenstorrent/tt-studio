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
  setIsLoading: (isLoading: boolean) => void,
) => {
  return new Promise<void>((resolve, reject) => {
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setIsLoading(false);
          resolve();
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
  modelID: string,
) => {
  if (videoRef.current) {
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          return;
        }
        const formData = new FormData();
        formData.append("image", blob, "canvas-image.jpg");
        formData.append("deploy_id", modelID);
        axios
          .post(`/models-api/object-detection/`, formData, {
            headers: { "Content-Type": "multipart/form-data" },
          })
          .then((response) => {
            const detectionMetadata: DetectionMetadata = {
              width: 320,
              height: 320,
              inferenceTime: 33.333,
            };
            const detections: Detection[] = response.data.map(
              (item: Array<number>) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
              },
            );
            setDetections({ boxes: detections, metadata: detectionMetadata });
          })
          .catch((error) => console.error("Error sending snapshot:", error));
      },
      "image/jpeg",
      1.0,
    );
  }
};

export const stopCapture = (
  videoRef: React.RefObject<HTMLVideoElement> | null,
) => {
  if (videoRef && videoRef.current && videoRef.current.srcObject) {
    const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
    tracks.forEach((track) => track.stop());
  }
};
