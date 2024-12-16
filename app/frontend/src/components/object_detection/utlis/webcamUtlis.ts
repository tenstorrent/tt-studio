// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
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

export const sendSnapshot = (
  videoRef: React.RefObject<HTMLVideoElement>,
  setDetections: (data: {
    boxes: Detection[];
    metadata: DetectionMetadata;
  }) => void,
) => {
  if (videoRef.current) {
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    const imageSrc = canvas.toDataURL("image/jpeg");

    fetch("http://localhost:5006/api/detect", {
      method: "POST",
      body: JSON.stringify({
        image: imageSrc,
        metadata: {
          width: canvas.width,
          height: canvas.height,
        },
      }),
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then((response) => response.json())
      .then((data) => {
        console.log(data);
        setDetections(data);
      })
      .catch((error) => console.error("Error sending snapshot:", error));
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
