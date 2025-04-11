// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useLayoutEffect, useEffect } from "react";
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
  setExternalControls,
  videoOnly = false,
}) => {
  const { isCapturing, handleStartCapture, handleStopCapture, videoRef } =
    useWebcam(
      setDetections,
      setLiveMode,
      setIsLoading,
      setIsStreaming,
      setIsCameraOn,
      modelID
    );

  // stop capture on component unmount
  // must use useLayoutEffect here so that cleanup function is
  // called *before* the component is removed from the DOM
  useLayoutEffect(() => {
    return () => {
      handleStopCapture();
    };
  }, [handleStopCapture]);

  // Create and set external controls when the component mounts or isCapturing changes
  useEffect(() => {
    if (setExternalControls) {
      const controls = (
        <div className="flex justify-center">
          {isCapturing ? (
            <Button
              onClick={handleStopCapture}
              variant="outline"
              className="w-full sm:w-auto"
            >
              Stop Capture
            </Button>
          ) : (
            <Button onClick={handleStartCapture} className="w-full sm:w-auto">
              Start Webcam
            </Button>
          )}
        </div>
      );
      setExternalControls(controls);
    }
  }, [isCapturing, handleStartCapture, handleStopCapture, setExternalControls]);

  return (
    <div className="relative flex flex-col bg-background/95 rounded-lg w-full h-full">
      {isCapturing && (
        <video
          ref={videoRef}
          className="w-full h-full object-cover rounded-lg max-h-[calc(70vh-8rem)]"
          autoPlay
          playsInline
          muted
        />
      )}
      {/* Only show internal controls if videoOnly is false or setExternalControls is not provided */}
      {(!videoOnly || !setExternalControls) && (
        <div className="absolute bottom-4 left-0 right-0 px-6 z-10">
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
      )}
    </div>
  );
};

export default WebcamPicker;
