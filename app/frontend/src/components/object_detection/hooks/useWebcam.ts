// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useState, useRef, useCallback, useEffect } from "react";
import {
  startCapture,
  stopCapture,
  sendSnapshot,
} from "../../object_detection/utlis/webcamUtlis";
import { Detection, DetectionMetadata } from "../types/objectDetection";

export const useWebcam = (
  setDetections: (data: {
    boxes: Detection[];
    metadata: DetectionMetadata;
  }) => void,
  setLiveMode: (mode: boolean) => void,
  setIsLoading: (isLoading: boolean) => void,
  setIsStreaming: (isStreaming: boolean) => void,
  setIsCameraOn: (isCameraOn: boolean) => void,
  modelID: string,
) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleStartCapture = useCallback(async () => {
    setIsCapturing(true);
    setLiveMode(true);
    setIsLoading(true);
    setIsStreaming(true);
    setIsCameraOn(true);

    try {
      await startCapture(videoRef, setDetections, setIsLoading);
      setIsLoading(false);

      const sendSnapshotInterval = () => {
        sendSnapshot(videoRef, setDetections, modelID);
      };

      sendSnapshotInterval();
      // Refactor this entire process so that we perform sequential, non-blocking invocations
      // of sendSnapshot
      intervalRef.current = window.setInterval(sendSnapshotInterval, 100);
    } catch (error) {
      console.error("Error accessing webcam:", error);
      setIsLoading(false);
    }
  }, [
    setDetections,
    setLiveMode,
    setIsLoading,
    setIsStreaming,
    setIsCameraOn,
    modelID,
  ]);

  const handleStopCapture = useCallback(() => {
    setIsCapturing(false);
    setLiveMode(false);
    setIsStreaming(false);
    setIsCameraOn(false);
    stopCapture(videoRef);
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [setLiveMode, setIsStreaming, setIsCameraOn]);

  useEffect(() => {
    return () => {
      stopCapture(videoRef);
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return { isCapturing, handleStartCapture, handleStopCapture, videoRef };
};
