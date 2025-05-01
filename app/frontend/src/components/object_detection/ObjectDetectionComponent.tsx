// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import React, { useState, useCallback, useRef, useEffect } from "react";
import { Card } from "../ui/card";
import { motion } from "framer-motion";
import SourcePicker from "./SourcePicker";
import WebcamPicker from "./WebcamPicker";
import { Detection, DetectionMetadata } from "./types/objectDetection";
import { updateBoxPositions } from "../object_detection/utlis/detectionUtlis";
import {
  getConfidenceColorClass,
  getLabelColorClass,
} from "./utlis/colorUtils";
import { AnimatedTabs } from "./AnimatedTabs";
import { Maximize2, Timer, Gauge, Activity } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui/resizable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

// Function to get the table cell text color for confidence
const getConfidenceTextColorClass = (confidence: number) => {
  if (confidence > 0.7) return "text-green-600";
  if (confidence > 0.5) return "text-yellow-600";
  return "text-red-600";
};

// Modified AnimatedTabs with adjusted underline position for initial load
const ModifiedAnimatedTabs = React.forwardRef<HTMLDivElement, {
  selectedTab: string;
  onTabChange: (tab: string) => void;
  onReset: () => void;
}>((props, ref) => {
  // This wrapper adjusts the initial position to center the underline under "Webcam"
  return (
    <div ref={ref} className="flex justify-center w-full">
      <div className="relative" style={{ marginLeft: "-12px" }}> {/* Adjust this value to center the underline */}
        <AnimatedTabs {...props} />
      </div>
    </div>
  );
});

export const ObjectDetectionComponent: React.FC = () => {
  const location = useLocation();
  const [modelID, setModelID] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState("webcam");
  const [isDesktopView, setIsDesktopView] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  
  // File-related state
  const [fileDetections, setFileDetections] = useState<Detection[]>([]);
  const [fileScaledDetections, setFileScaledDetections] = useState<Detection[]>([]);
  const [fileMetadata, setFileMetadata] = useState<DetectionMetadata | null>(null);
  const [fileHoveredIndex, setFileHoveredIndex] = useState<number | null>(null);
  const fileContainerRef = useRef<HTMLDivElement>(null);
  const [fileIsLiveMode, setFileIsLiveMode] = useState(false);
  
  // Webcam-related state
  const [webcamDetections, setWebcamDetections] = useState<Detection[]>([]);
  const [webcamScaledDetections, setWebcamScaledDetections] = useState<Detection[]>([]);
  const [webcamMetadata, setWebcamMetadata] = useState<DetectionMetadata | null>(null);
  const [webcamHoveredIndex, setWebcamHoveredIndex] = useState<number | null>(null);
  const webcamContainerRef = useRef<HTMLDivElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const [isWebcamLiveMode, setIsWebcamLiveMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [webcamControls, setWebcamControls] = useState<React.ReactNode>(null);

  // Get model ID from location state
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
  }, [location.state]);

  // Handle responsive layout
  useEffect(() => {
    const handleResize = () => {
      setIsDesktopView(window.innerWidth >= 768);
    };

    window.addEventListener("resize", handleResize);
    handleResize(); // Initial check

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Tab change handler
  const handleTabChange = useCallback((tab: string) => {
    // If switching to file tab, stop webcam
    if (tab === "file" && isCameraOn) {
      handleStopWebcam();
    }
    
    // Change the selected tab
    setSelectedTab(tab);
  }, [isCameraOn]);

  // Reset handlers
  const handleResetFile = useCallback(() => {
    setFileDetections([]);
    setFileScaledDetections([]);
    setFileMetadata(null);
    setFileIsLiveMode(false);
    setFileHoveredIndex(null);
  }, []);

  const handleResetWebcam = useCallback(() => {
    setWebcamDetections([]);
    setWebcamScaledDetections([]);
    setWebcamMetadata(null);
    setIsWebcamLiveMode(false);
    setWebcamHoveredIndex(null);
    setWebcamControls(null);
    setIsStreaming(false);
    setIsCameraOn(false);
    setIsLoading(false);
  }, []);

  const handleReset = useCallback(() => {
    if (selectedTab === "webcam") {
      handleResetWebcam();
    } else {
      handleResetFile();
    }
  }, [selectedTab, handleResetWebcam, handleResetFile]);

  // Webcam-specific functions
  const handleStopWebcam = useCallback(() => {
    setIsStreaming(false);
    setIsCameraOn(false);
    setIsLoading(false);
  }, []);

  const handleSetWebcamControls = useCallback((controls: React.ReactNode) => {
    setWebcamControls(controls);
  }, []);

  // File detection handlers
  const handleSetFileDetections = useCallback((data: { boxes: Detection[]; metadata: DetectionMetadata }) => {
    setFileDetections(Array.isArray(data.boxes) ? data.boxes : []);
    setFileMetadata(data.metadata);
  }, []);

  const handleSetFileLiveMode = useCallback((mode: boolean) => {
    setFileIsLiveMode(mode);
    if (!mode) {
      setFileHoveredIndex(null);
    }
  }, []);

  const handleFileHoverDetection = useCallback((index: number | null) => {
    setFileHoveredIndex(index);
  }, []);

  // Webcam detection handlers
  const handleSetWebcamDetections = useCallback((data: { boxes: Detection[]; metadata: DetectionMetadata }) => {
    setWebcamDetections(Array.isArray(data.boxes) ? data.boxes : []);
    setWebcamMetadata(data.metadata);
  }, []);

  const handleSetWebcamLiveMode = useCallback((mode: boolean) => {
    setIsWebcamLiveMode(mode);
    if (!mode) {
      setWebcamHoveredIndex(null);
    }
  }, []);

  const handleWebcamHoverDetection = useCallback((index: number | null) => {
    setWebcamHoveredIndex(index);
  }, []);

  // Update file bounding boxes
  useEffect(() => {
    if (!fileMetadata || fileDetections.length === 0 || !fileContainerRef.current) return;
    
    const updatedDetections = updateBoxPositions(
      fileContainerRef,
      null,
      fileMetadata,
      fileDetections
    );
    
    setFileScaledDetections(updatedDetections);
  }, [fileDetections, fileMetadata]);

  // Update webcam bounding boxes
  useEffect(() => {
    if (!webcamMetadata || webcamDetections.length === 0 || !isWebcamLiveMode || !webcamContainerRef.current) return;
    
    // Skip if video dimensions not ready
    if (webcamVideoRef.current && (webcamVideoRef.current.videoWidth === 0 || webcamVideoRef.current.videoHeight === 0)) {
      return;
    }
    
    const updatedDetections = updateBoxPositions(
      webcamContainerRef,
      webcamVideoRef,
      webcamMetadata,
      webcamDetections
    );
    
    setWebcamScaledDetections(updatedDetections);
  }, [webcamDetections, webcamMetadata, isWebcamLiveMode, isStreaming]);

  // Handle file container resize
  useEffect(() => {
    const containerElement = fileContainerRef.current;
    if (!containerElement || !fileMetadata || fileDetections.length === 0) return;
    
    const resizeObserver = new ResizeObserver(() => {
      const updatedDetections = updateBoxPositions(
        fileContainerRef,
        null,
        fileMetadata,
        fileDetections
      );
      setFileScaledDetections(updatedDetections);
    });
    
    resizeObserver.observe(containerElement);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [fileDetections, fileMetadata]);

  // Handle webcam container resize
  useEffect(() => {
    const containerElement = webcamContainerRef.current;
    if (!containerElement || !webcamMetadata || webcamDetections.length === 0 || !isWebcamLiveMode) return;
    
    const resizeObserver = new ResizeObserver(() => {
      const updatedDetections = updateBoxPositions(
        webcamContainerRef,
        webcamVideoRef,
        webcamMetadata,
        webcamDetections
      );
      setWebcamScaledDetections(updatedDetections);
    });
    
    resizeObserver.observe(containerElement);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [webcamDetections, webcamMetadata, isWebcamLiveMode]);

  // Special effect for webcam activation
  useEffect(() => {
    if (!isStreaming || !webcamMetadata || webcamDetections.length === 0 || !webcamContainerRef.current) return;
    
    const timer = setTimeout(() => {
      if (webcamVideoRef.current?.videoWidth > 0) {
        const updatedDetections = updateBoxPositions(
          webcamContainerRef,
          webcamVideoRef,
          webcamMetadata,
          webcamDetections
        );
        setWebcamScaledDetections(updatedDetections);
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [isStreaming, webcamMetadata, webcamDetections]);

  // Render detection results table
  const DetectionResultsTable = () => {
    const currentScaledDetections = selectedTab === "webcam" ? webcamScaledDetections : fileScaledDetections;
    const currentHoveredIndex = selectedTab === "webcam" ? webcamHoveredIndex : fileHoveredIndex;
    const handleHoverDetection = selectedTab === "webcam" ? handleWebcamHoverDetection : handleFileHoverDetection;
    
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 bg-background py-2 px-4 border-b">
          <Activity size={18} />
          <span className="font-semibold">Detection Results</span>
        </div>
        <div className="overflow-auto flex-grow p-2">
          <Table className="text-sm w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-2 whitespace-nowrap">#</TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">x-min</TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">y-min</TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">x-max</TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">y-max</TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">conf</TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">id</TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentScaledDetections.map((detection, index) => (
                <TableRow 
                  key={index}
                  className={currentHoveredIndex === index ? "bg-blue-50 dark:bg-blue-900/20" : ""}
                  onMouseEnter={() => handleHoverDetection(index)}
                  onMouseLeave={() => handleHoverDetection(null)}
                >
                  <TableCell className="px-2 py-2">{index}</TableCell>
                  <TableCell className="px-2 py-2">{detection.xmin?.toFixed(2)}</TableCell>
                  <TableCell className="px-2 py-2">{detection.ymin?.toFixed(2)}</TableCell>
                  <TableCell className="px-2 py-2">{detection.xmax?.toFixed(2)}</TableCell>
                  <TableCell className="px-2 py-2">{detection.ymax?.toFixed(2)}</TableCell>
                  <TableCell
                    className={`px-2 py-2 font-medium ${getConfidenceTextColorClass(detection.confidence)}`}
                  >
                    {detection.confidence?.toFixed(2)}
                  </TableCell>
                  <TableCell className="px-2 py-2">{detection.class}</TableCell>
                  <TableCell className="px-2 py-2 font-medium">{detection.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen w-full px-2 sm:px-4 pt-8 pb-4 sm:py-6 mx-auto">
      <Card className="border-2 p-4 pt-10 sm:pt-4 mt-2 sm:mt-0 rounded-md space-y-4 h-[calc(100vh-6rem)] max-h-[calc(100vh-6rem)] flex flex-col overflow-auto">
        {/* Metadata Display */}
        {((selectedTab === "webcam" && webcamMetadata) || (selectedTab === "file" && fileMetadata)) && (
          <div className="sticky top-0 pt-3 pb-2 z-10 flex flex-wrap justify-center items-center gap-2 sm:gap-3 bg-muted/70 backdrop-blur-sm px-2 sm:px-3 rounded-md flex-shrink-0 shadow-sm">
            <div className="flex items-center gap-2">
              <Maximize2 size={14} className="text-muted-foreground" />
              <span className="text-xs font-medium tracking-wide">
                {selectedTab === "webcam" 
                  ? `${webcamMetadata?.width} × ${webcamMetadata?.height}`
                  : `${fileMetadata?.width} × ${fileMetadata?.height}`
                }
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Timer size={14} className="text-muted-foreground" />
              <span className="text-xs font-medium tracking-wide">
                {selectedTab === "webcam"
                  ? (typeof webcamMetadata?.inferenceTime === "number"
                    ? `${webcamMetadata.inferenceTime.toFixed(1)} FPS`
                    : `${webcamMetadata?.inferenceTime} FPS`)
                  : (typeof fileMetadata?.inferenceTime === "number"
                    ? `${fileMetadata.inferenceTime.toFixed(1)} FPS`
                    : `${fileMetadata?.inferenceTime} FPS`)
                }
              </span>
            </div>
            {((selectedTab === "webcam" && webcamScaledDetections.length > 0) || 
              (selectedTab === "file" && fileScaledDetections.length > 0)) && (
              <div className="flex items-center gap-2">
                <Gauge size={14} className="text-muted-foreground" />
                <span className="text-xs font-medium tracking-wide">
                  {selectedTab === "webcam" 
                    ? `${webcamScaledDetections.length} detections`
                    : `${fileScaledDetections.length} detections`
                  }
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
              {/* Tabs */}
              <ModifiedAnimatedTabs
                ref={tabsRef}
                selectedTab={selectedTab}
                onTabChange={handleTabChange}
                onReset={handleReset}
              />
              
              {/* Content Area */}
              <div className="flex-grow overflow-auto">
                {/* File Tab */}
                {selectedTab === "file" && (
                  <div className="relative flex flex-col flex-grow min-h-0 h-full overflow-auto">
                    <div ref={fileContainerRef} className="h-full">
                      <SourcePicker
                        containerRef={fileContainerRef}
                        setDetections={handleSetFileDetections}
                        setLiveMode={handleSetFileLiveMode}
                        scaledDetections={fileScaledDetections}
                        modelID={modelID}
                        hoveredIndex={fileHoveredIndex}
                        onHoverDetection={handleFileHoverDetection}
                        isWebcamActive={isCameraOn}
                        stopWebcam={handleStopWebcam}
                      />
                    </div>
                  </div>
                )}
                
                {/* Webcam Tab */}
                {selectedTab === "webcam" && (
                  <div className="flex flex-col items-center gap-4 h-full">
                    <div
                      className="relative h-full flex-grow w-full"
                      ref={webcamContainerRef}
                    >
                      <WebcamPicker
                        setDetections={handleSetWebcamDetections}
                        setLiveMode={handleSetWebcamLiveMode}
                        setIsLoading={setIsLoading}
                        setIsStreaming={setIsStreaming}
                        setIsCameraOn={setIsCameraOn}
                        modelID={modelID}
                        setExternalControls={handleSetWebcamControls}
                        hoveredIndex={webcamHoveredIndex}
                        videoOnly={true}
                        videoRef={webcamVideoRef}
                      />
                      {isWebcamLiveMode && (
                        <div className="absolute inset-0 pointer-events-none">
                          {webcamScaledDetections.map((detection, index) => (
                            <div
                              key={index}
                              className={`absolute border-2 ${
                                index === webcamHoveredIndex
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
                              onMouseEnter={() => handleWebcamHoverDetection(index)}
                              onMouseLeave={() => handleWebcamHoverDetection(null)}
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
              </div>
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
            {((selectedTab === "webcam" && webcamScaledDetections.length > 0) || 
              (selectedTab === "file" && fileScaledDetections.length > 0)) ? (
              <DetectionResultsTable />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <p>No detections to display</p>
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </Card>
    </div>
  );
};