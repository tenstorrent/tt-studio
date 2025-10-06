// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useLayoutEffect, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { useWebcam } from "./hooks/useWebcam";
import { WebcamPickerProps } from "./types/objectDetection";
import { Video } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";

// Animation variants matching the FileUpload component
const mainVariant = {
  initial: { x: 0, y: 0 },
  animate: { x: 20, y: -20, opacity: 0.9 },
};

const secondaryVariant = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
};

function GridPattern() {
  const columns = 41;
  const rows = 11;
  return (
    <div className="flex bg-gray-100 dark:bg-neutral-900 shrink-0 flex-wrap justify-center items-center gap-x-px gap-y-px scale-105">
      {Array.from({ length: rows }).map((_, row) =>
        Array.from({ length: columns }).map((_, col) => {
          const index = row * columns + col;
          return (
            <div
              key={`${col}-${row}`}
              className={`w-10 h-10 flex shrink-0 rounded-[2px] ${
                index % 2 === 0
                  ? "bg-gray-50 dark:bg-neutral-950"
                  : "bg-gray-50 dark:bg-neutral-950 shadow-[0px_0px_1px_3px_rgba(255,255,255,1)_inset] dark:shadow-[0px_0px_1px_3px_rgba(0,0,0,1)_inset]"
              }`}
            />
          );
        })
      )}
    </div>
  );
}

const WebcamPicker: React.FC<WebcamPickerProps> = ({
  setDetections,
  setLiveMode,
  setIsLoading,
  setIsStreaming,
  setIsCameraOn,
  modelID,
  setExternalControls,
}) => {
  const { isCapturing, handleStartCapture, handleStopCapture, videoRef } = useWebcam(
    setDetections,
    setLiveMode,
    setIsLoading,
    setIsStreaming,
    setIsCameraOn,
    modelID ?? ""
  );

  // Add a state to track if the component is mounted/visible
  const [isMounted, setIsMounted] = useState(true);

  // When component mounts, set isMounted to true
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Stop webcam when component unmounts
  useLayoutEffect(() => {
    return () => {
      handleStopCapture();
    };
  }, [handleStopCapture]);

  // Reset the webcam state when the component becomes visible again
  useEffect(() => {
    if (isMounted && !isCapturing) {
      // Reset UI state to show the start button when switching back to webcam tab
      setIsLoading(false);
      setIsStreaming(false);
      setIsCameraOn(false);
    }
  }, [isMounted, isCapturing, setIsLoading, setIsStreaming, setIsCameraOn]);

  // External control buttons (for use in a parent tab bar if needed)
  useEffect(() => {
    if (setExternalControls) {
      const controls = (
        <div className="flex justify-center">
          {isCapturing ? (
            <Button onClick={handleStopCapture} variant="outline" className="w-full sm:w-auto">
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

  // Reset detection state when needed
  useEffect(() => {
    if (isMounted && !isCapturing) {
      setDetections({
        boxes: [],
        metadata: { width: 0, height: 0, inferenceTime: 0 },
      });
      setLiveMode(false);
    }
  }, [isMounted, isCapturing, setDetections, setLiveMode]);

  return (
    <div className="w-full space-y-4">
      {!isCapturing ? (
        <motion.div
          onClick={handleStartCapture}
          whileHover="animate"
          className="p-10 group/file block rounded-lg cursor-pointer w-full relative overflow-hidden"
        >
          <div className="absolute inset-0 mask-[radial-gradient(ellipse_at_center,white,transparent)]">
            <GridPattern />
          </div>
          <div className="flex flex-col items-center justify-center">
            <p className="relative z-20 font-sans font-bold text-neutral-700 dark:text-neutral-300 text-base">
              Start Webcam
            </p>
            <p className="relative z-20 font-sans font-normal text-neutral-400 dark:text-neutral-400 text-base mt-2">
              Click to activate your camera for object detection
            </p>
            <div className="relative w-full mt-10 max-w-xl mx-auto space-y-4 p-4">
              <motion.div
                layoutId="webcam-icon"
                variants={mainVariant}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className={cn(
                  "relative group-hover/file:shadow-2xl z-40 bg-white dark:bg-neutral-900 flex items-center justify-center h-32 w-full max-w-[8rem] mx-auto rounded-md",
                  "shadow-[0px_10px_50px_rgba(0,0,0,0.1)]"
                )}
              >
                <Video className="h-6 w-6 text-neutral-600 dark:text-neutral-300" />
              </motion.div>

              <motion.div
                variants={secondaryVariant}
                className="absolute opacity-0 border border-dashed border-TT-purple-accent inset-0 z-30 bg-transparent flex items-center justify-center h-32 w-full max-w-[8rem] mx-auto rounded-md"
              />
            </div>
          </div>
        </motion.div>
      ) : (
        <>
          {/* Stop button always visible above video */}
          <div className="flex justify-end">
            <Button onClick={handleStopCapture} variant="destructive">
              Stop Capture
            </Button>
          </div>

          {/* Video container for proper bounding box overlay */}
          <div className="relative w-full">
            <video
              ref={videoRef}
              className="w-full h-auto object-contain bg-background/95 rounded-lg"
              autoPlay
              playsInline
              muted
            />
            {/* PLACEHOLDER: Overlay layer for bounding boxes should go here */}
            {/* <BoundingBoxOverlay boxes={boxes} videoRef={videoRef} /> */}
          </div>
        </>
      )}
    </div>
  );
};

export default WebcamPicker;
