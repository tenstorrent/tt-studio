// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useLayoutEffect, useEffect } from "react";
import { Button } from "../ui/button";
import { useWebcam } from "./hooks/useWebcam";
import { WebcamPickerProps } from "./types/objectDetection";
import { EnhancedButton } from "../ui/enhanced-button";
import { Video, X } from "lucide-react";

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
            <EnhancedButton
              onClick={handleStopCapture}
              variant="outline"
              className="w-full sm:w-auto"
              effect="expandIcon"
              icon={X}
              iconPlacement="right"
            >
              Stop Capture
            </EnhancedButton>
          ) : (
            <EnhancedButton
              onClick={handleStartCapture}
              className="w-full sm:w-auto"
              effect="expandIcon"
              icon={Video}
              iconPlacement="right"
            >
              Start Webcam
            </EnhancedButton>
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
    </div>
  );
};

export default WebcamPicker;
