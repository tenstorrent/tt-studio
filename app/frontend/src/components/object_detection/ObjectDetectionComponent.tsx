// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { Card } from "../ui/card";

import SourcePicker from "./SourcePicker";
import WebcamPicker from "./WebcamPicker";
import { Detection, DetectionMetadata } from "./types/objectDetection";
import { updateBoxPositions } from "./utils/detectionUtils";
import {
  getConfidenceColorClass,
  getLabelColorClass,
  getConfidenceTextColorClass,
} from "./utils/colorUtils";
import { AnimatedTabs } from "./AnimatedTabs";
import {
  Maximize2,
  Timer,
  Gauge,
  Activity,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
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

// Modified AnimatedTabs with adjusted underline position for initial load
const ModifiedAnimatedTabs = React.forwardRef<
  HTMLDivElement,
  {
    selectedTab: string;
    onTabChange: (tab: string) => void;
    onReset: () => void;
  }
>((props, ref) => {
  return (
    <div ref={ref} className="flex justify-center w-full">
      <div className="relative" style={{ marginLeft: "-12px" }}>
        <AnimatedTabs {...props} />
      </div>
    </div>
  );
});

export const ObjectDetectionComponent: React.FC = () => {
  const location = useLocation();
  const [modelID, setModelID] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState("webcam");
  const [isDesktopView, setIsDesktopView] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);

  // File-related state
  const [fileDetections, setFileDetections] = useState<Detection[]>([]);
  const [fileScaledDetections, setFileScaledDetections] = useState<Detection[]>(
    []
  );
  const [fileMetadata, setFileMetadata] = useState<DetectionMetadata | null>(
    null
  );
  const [fileHoveredIndex, setFileHoveredIndex] = useState<number | null>(null);
  const fileContainerRef = useRef<HTMLDivElement>(null);

  // Webcam-related state
  const [webcamDetections, setWebcamDetections] = useState<Detection[]>([]);
  const [webcamScaledDetections, setWebcamScaledDetections] = useState<
    Detection[]
  >([]);
  const [webcamMetadata, setWebcamMetadata] =
    useState<DetectionMetadata | null>(null);
  const [webcamHoveredIndex, setWebcamHoveredIndex] = useState<number | null>(
    null
  );
  const webcamContainerRef = useRef<HTMLDivElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const [isWebcamLiveMode, setIsWebcamLiveMode] = useState(false);
  const [_isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);

  // State for expandable rows in detection table
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

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
  const handleTabChange = useCallback(
    (tab: string) => {
      // If switching to file tab, stop webcam
      if (tab === "file" && isCameraOn) {
        handleStopWebcam();
      }

      // Change the selected tab
      setSelectedTab(tab);
    },
    [isCameraOn]
  );

  // Reset handlers
  const handleResetFile = useCallback(() => {
    setFileDetections([]);
    setFileScaledDetections([]);
    setFileMetadata(null);
    setFileHoveredIndex(null);
  }, []);

  const handleResetWebcam = useCallback(() => {
    setWebcamDetections([]);
    setWebcamScaledDetections([]);
    setWebcamMetadata(null);
    setIsWebcamLiveMode(false);
    setWebcamHoveredIndex(null);
    setIsStreaming(false);
    setIsCameraOn(false);
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
    // Clear webcam detections when stopping webcam
    setWebcamScaledDetections([]);
    setWebcamDetections([]);
    setIsWebcamLiveMode(false);
  }, []);

  const handleSetWebcamControls = useCallback((_: React.ReactNode) => {
    // This function is kept for API compatibility but we don't need to store the controls
  }, []);

  // File detection handlers
  const handleSetFileDetections = useCallback(
    (data: { boxes: Detection[]; metadata: DetectionMetadata }) => {
      // If there are no boxes, clear the scaled detections as well
      if (!data.boxes || data.boxes.length === 0) {
        setFileScaledDetections([]);
      }

      setFileDetections(Array.isArray(data.boxes) ? data.boxes : []);
      setFileMetadata(data.metadata);
    },
    []
  );

  const handleSetFileLiveMode = useCallback((_mode: boolean) => {
    // This function is kept for API compatibility but we don't need to store the mode
  }, []);

  const handleFileHoverDetection = useCallback((index: number | null) => {
    setFileHoveredIndex(index);
  }, []);

  // Webcam detection handlers
  const handleSetWebcamDetections = useCallback(
    (data: { boxes: Detection[]; metadata: DetectionMetadata }) => {
      // If there are no boxes, clear the scaled detections as well
      if (!data.boxes || data.boxes.length === 0) {
        setWebcamScaledDetections([]);
      }

      setWebcamDetections(Array.isArray(data.boxes) ? data.boxes : []);
      setWebcamMetadata(data.metadata);
    },
    []
  );

  const handleSetWebcamLiveMode = useCallback((mode: boolean) => {
    setIsWebcamLiveMode(mode);
    // Clear scaled detections when turning off live mode
    if (!mode) {
      setWebcamHoveredIndex(null);
      setWebcamScaledDetections([]);
    }
  }, []);

  const handleWebcamHoverDetection = useCallback((index: number | null) => {
    setWebcamHoveredIndex(index);
  }, []);

  // Toggle expanded row in the detection results table
  const toggleRow = useCallback((index: number) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  }, []);

  // Update file bounding boxes
  useEffect(() => {
    if (
      !fileMetadata ||
      fileDetections.length === 0 ||
      !fileContainerRef.current
    ) {
      // Clear scaled detections if there are no detections
      if (fileScaledDetections.length > 0) {
        setFileScaledDetections([]);
      }
      return;
    }

    const updatedDetections = updateBoxPositions(
      fileContainerRef,
      null,
      fileMetadata,
      fileDetections
    );

    setFileScaledDetections(updatedDetections);
  }, [fileDetections, fileMetadata, fileScaledDetections.length]);

  // Update webcam bounding boxes - UPDATED
  useEffect(() => {
    if (
      !webcamMetadata ||
      webcamDetections.length === 0 ||
      !isWebcamLiveMode ||
      !webcamContainerRef.current
    ) {
      // Clear scaled detections if there are no detections or not in live mode
      if (webcamScaledDetections.length > 0) {
        setWebcamScaledDetections([]);
      }
      return;
    }

    // Skip if video dimensions not ready
    if (
      webcamVideoRef.current &&
      (webcamVideoRef.current.videoWidth! === 0 ||
        webcamVideoRef.current.videoHeight! === 0)
    ) {
      return;
    }

    // Use requestAnimationFrame for smoother updates
    requestAnimationFrame(() => {
      const updatedDetections = updateBoxPositions(
        webcamContainerRef,
        webcamVideoRef,
        webcamMetadata,
        webcamDetections
      );

      setWebcamScaledDetections(updatedDetections);
    });
  }, [
    webcamDetections,
    webcamMetadata,
    isWebcamLiveMode,
    isStreaming,
    webcamScaledDetections.length,
  ]);

  // NEW effect for video metadata loading
  useEffect(() => {
    // Handle video metadata loading
    const handleVideoMetadataLoaded = () => {
      if (
        webcamDetections.length > 0 &&
        webcamMetadata &&
        webcamContainerRef.current
      ) {
        const updatedDetections = updateBoxPositions(
          webcamContainerRef,
          webcamVideoRef,
          webcamMetadata,
          webcamDetections
        );
        setWebcamScaledDetections(updatedDetections);
      }
    };

    // Add event listener for video metadata loading
    const videoElement = webcamVideoRef.current;
    if (videoElement && isWebcamLiveMode) {
      videoElement.addEventListener(
        "loadedmetadata",
        handleVideoMetadataLoaded
      );
      videoElement.addEventListener("resize", handleVideoMetadataLoaded);
    }

    return () => {
      if (videoElement) {
        videoElement.removeEventListener(
          "loadedmetadata",
          handleVideoMetadataLoaded
        );
        videoElement.removeEventListener("resize", handleVideoMetadataLoaded);
      }
    };
  }, [
    webcamVideoRef.current,
    isWebcamLiveMode,
    webcamDetections,
    webcamMetadata,
  ]);

  // Handle file container resize
  useEffect(() => {
    const containerElement = fileContainerRef.current;
    if (!containerElement || !fileMetadata || fileDetections.length === 0)
      return;

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

  // Handle webcam container resize - UPDATED
  useEffect(() => {
    const containerElement = webcamContainerRef.current;
    if (
      !containerElement ||
      !webcamMetadata ||
      webcamDetections.length === 0 ||
      !isWebcamLiveMode
    )
      return;

    // Create a more robust handler that checks video dimensions
    const updateWebcamBoxes = () => {
      // Only update if video dimensions are available
      const videoElement = webcamVideoRef.current;
      if (
        videoElement &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0
      ) {
        const updatedDetections = updateBoxPositions(
          webcamContainerRef,
          webcamVideoRef,
          webcamMetadata,
          webcamDetections
        );
        setWebcamScaledDetections(updatedDetections);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to ensure DOM measurements are accurate
      requestAnimationFrame(updateWebcamBoxes);
    });

    resizeObserver.observe(containerElement);

    // Also observe the video element itself for size changes
    if (webcamVideoRef.current) {
      resizeObserver.observe(webcamVideoRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [webcamDetections, webcamMetadata, isWebcamLiveMode]);

  // Special effect for webcam activation
  useEffect(() => {
    if (
      !isStreaming ||
      !webcamMetadata ||
      webcamDetections.length === 0 ||
      !webcamContainerRef.current
    )
      return;

    const timer = setTimeout(() => {
      const videoElement = webcamVideoRef.current;
      if (videoElement && videoElement.videoWidth > 0) {
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

  // Clear webcam scaled detections when webcam is stopped
  useEffect(() => {
    if (!isCameraOn && webcamScaledDetections.length > 0) {
      setWebcamScaledDetections([]);
    }
  }, [isCameraOn, webcamScaledDetections.length]);

  // Memoized detection components for better performance
  const DetectionResultsTable = useMemo(() => {
    const currentScaledDetections =
      selectedTab === "webcam" ? webcamScaledDetections : fileScaledDetections;
    const currentHoveredIndex =
      selectedTab === "webcam" ? webcamHoveredIndex : fileHoveredIndex;
    const handleHoverDetection =
      selectedTab === "webcam"
        ? handleWebcamHoverDetection
        : handleFileHoverDetection;

    if (currentScaledDetections.length === 0) {
      return null;
    }

    return (
      <div className="h-full flex flex-col p-4">
        <div className="grow overflow-hidden flex flex-col bg-background rounded-lg border shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-muted-foreground" />
              <span className="text-sm font-semibold">Detection Results</span>
            </div>
          </div>
          <div className="overflow-y-auto grow">
            <Table className="w-full">
              <TableHeader className="bg-muted/30 sticky top-0 z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[48px] text-center whitespace-nowrap py-3 px-2">
                    Details
                  </TableHead>
                  <TableHead className="w-[100px] text-center whitespace-nowrap py-3">
                    Confidence
                  </TableHead>
                  <TableHead className="text-left whitespace-nowrap py-3 pl-4">
                    Object
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentScaledDetections.map((detection, index) => (
                  <React.Fragment key={index}>
                    <TableRow
                      className={`hover:bg-muted/40 transition-colors ${
                        index === currentHoveredIndex
                          ? "bg-blue-50 dark:bg-blue-900/20"
                          : ""
                      }`}
                      onMouseEnter={() => handleHoverDetection(index)}
                      onMouseLeave={() => handleHoverDetection(null)}
                    >
                      <TableCell className="text-center py-2 px-2 w-[48px]">
                        <button
                          onClick={() => toggleRow(index)}
                          className="p-1 hover:bg-muted/60 rounded-md transition-colors"
                        >
                          {expandedRows.has(index) ? (
                            <ChevronDown
                              size={16}
                              className="text-muted-foreground"
                            />
                          ) : (
                            <ChevronRight
                              size={16}
                              className="text-muted-foreground"
                            />
                          )}
                        </button>
                      </TableCell>
                      <TableCell
                        className={`text-center font-medium py-2 w-[100px] ${getConfidenceTextColorClass(
                          detection.confidence
                        )}`}
                      >
                        {(detection.confidence * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-left font-medium py-2 pl-4">
                        {detection.name}
                      </TableCell>
                    </TableRow>
                    {expandedRows.has(index) && (
                      <TableRow className="bg-muted/10 border-y border-muted">
                        <TableCell colSpan={3} className="px-6 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                            <div className="space-y-2">
                              <div>
                                <span className="text-muted-foreground">
                                  ID:{" "}
                                </span>
                                <span className="font-medium">
                                  {detection.class}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  x-min:{" "}
                                </span>
                                <span className="font-mono">
                                  {detection.xmin?.toFixed(3)}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div>
                                <span className="text-muted-foreground">
                                  y-min:{" "}
                                </span>
                                <span className="font-mono">
                                  {detection.ymin?.toFixed(3)}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  x-max:{" "}
                                </span>
                                <span className="font-mono">
                                  {detection.xmax?.toFixed(3)}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div>
                                <span className="text-muted-foreground">
                                  y-max:{" "}
                                </span>
                                <span className="font-mono">
                                  {detection.ymax?.toFixed(3)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    );
  }, [
    selectedTab,
    webcamScaledDetections,
    fileScaledDetections,
    webcamHoveredIndex,
    fileHoveredIndex,
    expandedRows,
    handleWebcamHoverDetection,
    handleFileHoverDetection,
    toggleRow,
  ]);

  // Memoized mobile detection table
  const MobileDetectionResultsTable = useMemo(() => {
    const currentScaledDetections =
      selectedTab === "webcam" ? webcamScaledDetections : fileScaledDetections;
    const currentHoveredIndex =
      selectedTab === "webcam" ? webcamHoveredIndex : fileHoveredIndex;
    const handleHoverDetection =
      selectedTab === "webcam"
        ? handleWebcamHoverDetection
        : handleFileHoverDetection;

    if (currentScaledDetections.length === 0) {
      return null;
    }

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 bg-background py-2 px-4 border-b">
          <Activity size={18} />
          <span className="font-semibold">Detection Results</span>
        </div>
        <div className="overflow-auto grow p-2">
          <Table className="text-sm w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-2 whitespace-nowrap">#</TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">
                  x-min
                </TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">
                  y-min
                </TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">
                  x-max
                </TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">
                  y-max
                </TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">
                  conf
                </TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">
                  id
                </TableHead>
                <TableHead className="px-2 py-2 whitespace-nowrap">
                  name
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentScaledDetections.map((detection, index) => (
                <TableRow
                  key={index}
                  className={
                    currentHoveredIndex === index
                      ? "bg-blue-50 dark:bg-blue-900/20"
                      : ""
                  }
                  onMouseEnter={() => handleHoverDetection(index)}
                  onMouseLeave={() => handleHoverDetection(null)}
                >
                  <TableCell className="px-2 py-2">{index}</TableCell>
                  <TableCell className="px-2 py-2">
                    {detection.xmin?.toFixed(2)}
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    {detection.ymin?.toFixed(2)}
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    {detection.xmax?.toFixed(2)}
                  </TableCell>
                  <TableCell className="px-2 py-2">
                    {detection.ymax?.toFixed(2)}
                  </TableCell>
                  <TableCell
                    className={`px-2 py-2 font-medium ${getConfidenceTextColorClass(detection.confidence)}`}
                  >
                    {detection.confidence?.toFixed(2)}
                  </TableCell>
                  <TableCell className="px-2 py-2">{detection.class}</TableCell>
                  <TableCell className="px-2 py-2 font-medium">
                    {detection.name}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }, [
    selectedTab,
    webcamScaledDetections,
    fileScaledDetections,
    webcamHoveredIndex,
    fileHoveredIndex,
    handleWebcamHoverDetection,
    handleFileHoverDetection,
  ]);

  // Memoized detection boxes for webcam view
  const WebcamDetectionBoxes = useMemo(() => {
    if (!isWebcamLiveMode || webcamScaledDetections.length === 0) {
      return null;
    }

    return (
      <div className="absolute inset-0 pointer-events-none">
        {webcamScaledDetections.map((detection, index) => (
          <div
            key={index}
            className={`absolute border-2 ${
              index === webcamHoveredIndex
                ? "border-blue-500 bg-blue-500/30 shadow-lg"
                : getConfidenceColorClass(detection.confidence)
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
              {detection.name} ({(detection.confidence * 100).toFixed(1)}%)
            </div>
          </div>
        ))}
      </div>
    );
  }, [
    isWebcamLiveMode,
    webcamScaledDetections,
    webcamHoveredIndex,
    handleWebcamHoverDetection,
  ]);

  // Memoized metadata display
  const MetadataDisplay = useMemo(() => {
    const currentMetadata =
      selectedTab === "webcam" ? webcamMetadata : fileMetadata;
    const currentScaledDetections =
      selectedTab === "webcam" ? webcamScaledDetections : fileScaledDetections;

    if (!currentMetadata) {
      return null;
    }

    return (
      <div className="sticky top-0 pt-3 pb-2 z-10 flex flex-wrap justify-center items-center gap-2 sm:gap-3 bg-muted/70 backdrop-blur-sm px-2 sm:px-3 rounded-md shrink-0 shadow-sm">
        <div className="flex items-center gap-2">
          <Maximize2 size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium tracking-wide">
            {`${currentMetadata.width} × ${currentMetadata.height}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Timer size={14} className="text-muted-foreground" />
          <span className="text-xs font-medium tracking-wide">
            {typeof currentMetadata.inferenceTime === "number"
              ? `${currentMetadata.inferenceTime.toFixed(1)} FPS`
              : `${currentMetadata.inferenceTime} FPS`}
          </span>
        </div>
        {currentScaledDetections.length > 0 && (
          <div className="flex items-center gap-2">
            <Gauge size={14} className="text-muted-foreground" />
            <span className="text-xs font-medium tracking-wide">
              {`${currentScaledDetections.length} detections`}
            </span>
          </div>
        )}
      </div>
    );
  }, [
    selectedTab,
    webcamMetadata,
    fileMetadata,
    webcamScaledDetections,
    fileScaledDetections,
  ]);

  return (
    <div className="flex flex-col h-screen w-full px-2 sm:px-4 pt-8 pb-20 sm:py-6 mx-auto">
      <Card className="border-2 p-4 pt-10 sm:pt-4 mt-2 sm:mt-0 rounded-md space-y-4 h-[calc(100vh-6rem)] max-h-[calc(100vh-6rem)] flex flex-col overflow-auto">
        {/* Metadata Display */}
        {MetadataDisplay}

        <ResizablePanelGroup
          direction={isDesktopView ? "horizontal" : "vertical"}
          className="grow overflow-auto"
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
              <div className="grow overflow-auto">
                {/* File Tab */}
                {selectedTab === "file" && (
                  <div className="relative flex flex-col grow min-h-0 h-full overflow-auto">
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
                      className="relative h-full grow w-full"
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
                      {WebcamDetectionBoxes}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle
            className={`bg-border rounded-sm transition-all data-[dragging=true]:bg-accent
              ${isDesktopView ? "w-2 h-auto hover:w-2" : "h-2 w-full hover:h-2 mt-1 sm:mt-2"}`}
          />

          <ResizablePanel defaultSize={30} minSize={20}>
            {(selectedTab === "webcam" && webcamScaledDetections.length > 0) ||
            (selectedTab === "file" && fileScaledDetections.length > 0) ? (
              isDesktopView ? (
                DetectionResultsTable
              ) : (
                MobileDetectionResultsTable
              )
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
