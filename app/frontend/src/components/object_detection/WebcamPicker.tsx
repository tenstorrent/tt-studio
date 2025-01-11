// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useLayoutEffect } from "react";
import { Button } from "../ui/button";
import { useWebcam } from "./hooks/useWebcam";
import { WebcamPickerProps } from "./types/objectDetection";

const WebcamPicker: React.FC<WebcamPickerProps> = ({
  setDetections,
  setLiveMode,
  setIsLoading,
  setIsStreaming,
  setIsCameraOn,
  modelID,
}) => {
  const { isCapturing, handleStartCapture, handleStopCapture, videoRef } =
    useWebcam(
      setDetections,
      setLiveMode,
      setIsLoading,
      setIsStreaming,
      setIsCameraOn,
      modelID,
    );

  // stop capture on component unmount
  // must use useLayoutEffect here so that cleanup function is
  // called *before* the component is removed from the DOM
  useLayoutEffect(() => {
    return () => {
      handleStopCapture();
    };
  }, [handleStopCapture]);

  return (
    <div className="flex flex-col bg-background/95 rounded-lg">
      {isCapturing && (
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover rounded-lg"
          autoPlay
          playsInline
          muted
        />
      )}
      <div className="absolute bottom-4 left-0 right-0 px-6">
        {isCapturing ? (
          <Button
            onClick={handleStopCapture}
            variant="outline"
            className="w-full bg-background/80 backdrop-blur"
          >
            Stop Capture
          </Button>
        ) : (
          <Button onClick={handleStartCapture} className="w-full">
            Start Webcam
          </Button>
        )}
      </div>
    </div>
  );
};

export default WebcamPicker;
