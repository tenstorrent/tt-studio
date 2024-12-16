// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import { Button } from "../ui/button";
import { useWebcam } from "..//object_detection/hooks/useWebCam";
import { WebcamPickerProps } from "./types/objectDetection";

const WebcamPicker: React.FC<WebcamPickerProps> = ({
  setDetections,
  setLiveMode,
  setIsLoading,
  setIsStreaming,
  setIsCameraOn,
}) => {
  const { isCapturing, handleStartCapture, handleStopCapture, videoRef } =
    useWebcam(
      setDetections,
      setLiveMode,
      setIsLoading,
      setIsStreaming,
      setIsCameraOn,
    );

  return (
    <div className="flex flex-col items-center space-y-4">
      {isCapturing ? (
        <div className="flex space-x-2">
          <Button onClick={handleStopCapture} variant="outline">
            Stop Capture
          </Button>
        </div>
      ) : (
        <Button onClick={handleStartCapture} className="w-full max-w-md">
          Start Webcam
        </Button>
      )}
      {isCapturing && (
        <video
          ref={videoRef}
          className="w-full aspect-video object-cover"
          autoPlay
          playsInline
          muted
        />
      )}
    </div>
  );
};

export default WebcamPicker;
