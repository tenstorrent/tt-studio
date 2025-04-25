// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import React, { useState, useCallback, useRef, useEffect } from "react";
import { Card } from "../ui/card";
import { motion, AnimatePresence } from "framer-motion";
import SourcePicker from "./SourcePicker";
import WebcamPicker from "./WebcamPicker";
import { Detection, DetectionMetadata } from "./types/objectDetection";
import { updateBoxPositions } from "../object_detection/utlis/detectionUtlis";
import {
  getConfidenceColorClass,
  getLabelColorClass,
} from "./utlis/colorUtils";
import { DetectionResultsTable } from "./DetectionResultsTable";
import { AnimatedTabs } from "./AnimatedTabs";
import { Maximize2, Timer, Gauge } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui/resizable";

const transition = {
  type: "tween",
  ease: "easeOut",
  duration: 0.15,
};

export const ObjectDetectionComponent: React.FC = () => {
  const [selectedTab, setSelectedTab] = useState("webcam");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [scaledDetections, setScaledDetections] = useState<Detection[]>([]);
  const [metadata, setMetadata] = useState<DetectionMetadata | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [webcamControls, setWebcamControls] = useState<React.ReactNode>(null);
  const [isDesktopView, setIsDesktopView] = useState(false);

  // Handle responsive layout
  useEffect(() => {
    const handleResize = () => {
      setIsDesktopView(window.innerWidth >= 768);
    };

    window.addEventListener("resize", handleResize);
    handleResize(); // Initial check

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleSetWebcamControls = useCallback((controls: React.ReactNode) => {
    setWebcamControls(controls);
  }, []);

  const handleSetDetections = useCallback(
    (data: { boxes: Detection[]; metadata: DetectionMetadata }) => {
      setDetections(Array.isArray(data.boxes) ? data.boxes : []);
      setMetadata(data.metadata);
    },
    []
  );

  const handleSetLiveMode = useCallback((mode: boolean) => {
    setIsLiveMode(mode);
    if (!mode) {
      setHoveredIndex(null);
    }
  }, []);

  const handleHoverDetection = useCallback((index: number | null) => {
    setHoveredIndex(index);
  }, []);

  const handleTabChange = useCallback((tab: string) => {
    setSelectedTab(tab);
    // Reset webcam controls when switching away from webcam tab
    if (tab !== "webcam") {
      setWebcamControls(null);
      setIsStreaming(false);
      setIsCameraOn(false);
      setIsLoading(false);
    } else {
      // Reset detections when switching to webcam tab
      setDetections([]);
      setScaledDetections([]);
      setMetadata(null);
      setIsLiveMode(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    setDetections([]);
    setScaledDetections([]);
    setMetadata(null);
    setIsLiveMode(false);
    // Reset webcam-specific state
    setWebcamControls(null);
    setIsStreaming(false);
    setIsCameraOn(false);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const containerElement = containerRef.current;
    if (!containerElement) return;

    const resizeObserver = new ResizeObserver(() => {
      if (isLiveMode || detections.length > 0) {
        const updatedDetections = updateBoxPositions(
          containerRef,
          null,
          metadata,
          detections
        );
        setScaledDetections(updatedDetections);
      }
    });

    resizeObserver.observe(containerElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [detections, isLiveMode, metadata]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isLiveMode || detections.length > 0) {
        const updatedDetections = updateBoxPositions(
          containerRef,
          null,
          metadata,
          detections
        );
        setScaledDetections(updatedDetections);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isLiveMode, detections, metadata, isDesktopView]);

  useEffect(() => {
    setHoveredIndex(null);
  }, [metadata?.width, metadata?.height]);

  const location = useLocation();
  const [modelID, setModelID] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);

  useEffect(() => {
    if (location.state) {
      if (!location.state.containerID) {
        customToast.error(
          "modelID is unavailable. Try navigating here from the Models Deployed tab"
        );
        return;
      }
      setModelID(location.state.containerID);
      setModelName(location.state.modelName);
    }
  }, [location.state, modelID, modelName]);

  return (
    <div className="flex flex-col h-screen w-full px-2 sm:px-4 pt-8 pb-4 sm:py-6 mx-auto">
      <Card className="border-2 p-4 pt-10 sm:pt-4 mt-2 sm:mt-0 rounded-md space-y-4 h-[calc(100vh-6rem)] max-h-[calc(100vh-6rem)] flex flex-col overflow-auto">
        {metadata && (
          <div className="sticky top-0 pt-3 pb-2 z-10 flex flex-wrap justify-center items-center gap-2 sm:gap-3 bg-muted/70 backdrop-blur-sm px-2 sm:px-3 rounded-md flex-shrink-0 shadow-sm">
            <div className="flex items-center gap-2">
              <Maximize2 size={14} className="text-muted-foreground" />
              <span className="text-xs font-medium tracking-wide">
                {metadata.width} × {metadata.height}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Timer size={14} className="text-muted-foreground" />
              <span className="text-xs font-medium tracking-wide">
                {typeof metadata.inferenceTime === "number"
                  ? `${metadata.inferenceTime.toFixed(1)} FPS`
                  : `${metadata.inferenceTime} FPS`}
              </span>
            </div>
            {scaledDetections.length > 0 && (
              <div className="flex items-center gap-2">
                <Gauge size={14} className="text-muted-foreground" />
                <span className="text-xs font-medium tracking-wide">
                  {scaledDetections.length} detections
                </span>
              </div>
            )}
          </div>
        )}
        <ResizablePanelGroup
          direction={isDesktopView ? "horizontal" : "vertical"}
          className="flex-grow overflow-auto"
        >
          <ResizablePanel defaultSize={70} minSize={30}>
            <div className="w-full h-full flex flex-col overflow-hidden pt-3 sm:pt-1">
              <AnimatedTabs
                selectedTab={selectedTab}
                onTabChange={handleTabChange}
                onReset={handleReset}
              />

              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={transition}
                  className="flex-grow overflow-hidden"
                >
                  {selectedTab === "file" && (
                    <div className="relative flex flex-col flex-grow min-h-0">
                      <SourcePicker
                        containerRef={containerRef}
                        setDetections={handleSetDetections}
                        setLiveMode={handleSetLiveMode}
                        scaledDetections={scaledDetections}
                        modelID={modelID}
                        hoveredIndex={hoveredIndex}
                        onHoverDetection={handleHoverDetection}
                      />
                    </div>
                  )}
                  {selectedTab === "webcam" && (
                    <div className="flex flex-col items-center gap-4 h-full">
                      <div className="w-full sm:w-[90%] md:w-[75%] mb-6">
                        {webcamControls}
                      </div>
                      <div
                        className="relative h-full flex-grow"
                        ref={containerRef}
                      >
                        <WebcamPicker
                          setDetections={handleSetDetections}
                          setLiveMode={handleSetLiveMode}
                          setIsLoading={setIsLoading}
                          setIsStreaming={setIsStreaming}
                          setIsCameraOn={setIsCameraOn}
                          modelID={modelID}
                          setExternalControls={handleSetWebcamControls}
                          hoveredIndex={hoveredIndex}
                          videoOnly={true}
                        />
                        {isLiveMode && (
                          <div className="absolute inset-0 pointer-events-none">
                            {scaledDetections.map((detection, index) => (
                              <div
                                key={index}
                                className={`absolute border-2 ${
                                  index === hoveredIndex
                                    ? "border-blue-500 bg-blue-500/30 shadow-lg"
                                    : getConfidenceColorClass(
                                        detection.confidence
                                      )
                                }`}
                                style={{
                                  left: `${detection.scaledXmin ?? detection.xmin}px`,
                                  top: `${detection.scaledYmin ?? detection.ymin}px`,
                                  width: `${detection.scaledWidth ?? detection.xmax - detection.xmin}px`,
                                  height: `${detection.scaledHeight ?? detection.ymax - detection.ymin}px`,
                                }}
                                onMouseEnter={() => handleHoverDetection(index)}
                                onMouseLeave={() => handleHoverDetection(null)}
                              >
                                <div
                                  className={`absolute top-0 left-0 px-1 text-xs ${getLabelColorClass(
                                    detection.confidence
                                  )}`}
                                >
                                  {detection.name} (
                                  {(detection.confidence * 100).toFixed(1)}%)
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </ResizablePanel>

          <ResizableHandle
            className={`bg-border rounded-sm transition-all data-[dragging=true]:bg-accent
              ${
                isDesktopView
                  ? "w-2 h-auto hover:w-2"
                  : "h-2 w-full hover:h-2 mt-1 sm:mt-2"
              }`}
          />

          <ResizablePanel defaultSize={30} minSize={20}>
            <DetectionResultsTable
              scaledDetections={scaledDetections}
              hoveredIndex={hoveredIndex}
              onHoverDetection={handleHoverDetection}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </Card>
    </div>
  );
};
