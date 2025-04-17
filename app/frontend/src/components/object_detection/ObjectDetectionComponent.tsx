// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useLocation } from "react-router-dom";
import { customToast } from "../CustomToaster";
import React, { useState, useCallback, useRef, useEffect } from "react";
import { Card } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import SourcePicker from "./SourcePicker";
import WebcamPicker from "./WebcamPicker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Detection, DetectionMetadata } from "./types/objectDetection";
import { updateBoxPositions } from "../object_detection/utlis/detectionUtlis";
// Import icons
import { Clock, Maximize2, Video, Image, Activity, Tag } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui/resizable";

export const ObjectDetectionComponent: React.FC = () => {
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

  useEffect(() => {
    if (isLiveMode || detections.length > 0) {
      const updatedDetections = updateBoxPositions(
        containerRef,
        null,
        metadata,
        detections
      );
      setScaledDetections(updatedDetections);
    }
  }, [isLiveMode, detections, metadata]);

  // Reset hover state when metadata changes
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

  // Function to get the confidence color class
  const getConfidenceColorClass = (confidence: number) => {
    if (confidence > 0.7) return "border-green-500";
    if (confidence > 0.5) return "border-yellow-500";
    return "border-red-500";
  };

  // Function to get the background color class for the label
  const getLabelColorClass = (confidence: number) => {
    if (confidence > 0.7) return "bg-green-500";
    if (confidence > 0.5) return "bg-yellow-500";
    return "bg-red-500";
  };

  // Function to get the table cell text color for confidence
  const getConfidenceTextColorClass = (confidence: number) => {
    if (confidence > 0.7) return "text-green-600";
    if (confidence > 0.5) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="flex flex-col h-screen w-full sm:w-[90%] md:w-3/4 mx-auto max-w-7xl px-2 sm:px-4 py-4 sm:py-6">
      <Card className="border-2 p-4 rounded-md space-y-4 h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
        <ResizablePanelGroup
          direction="vertical"
          className="flex-grow overflow-hidden"
        >
          <ResizablePanel defaultSize={70} minSize={30}>
            <Tabs
              defaultValue="webcam"
              className="w-full h-full flex flex-col overflow-hidden"
              onValueChange={(value) => {
                // Clear detections when switching tabs
                setDetections([]);
                setScaledDetections([]);
                setMetadata(null);
                setIsLiveMode(false);
              }}
            >
              <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
                <TabsTrigger value="file" className="flex items-center gap-2">
                  <Image size={16} />
                  <span>File Upload</span>
                </TabsTrigger>
                <TabsTrigger value="webcam" className="flex items-center gap-2">
                  <Video size={16} />
                  <span>Webcam</span>
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="file"
                className="flex-grow overflow-auto flex flex-col"
              >
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
              </TabsContent>
              <TabsContent
                value="webcam"
                className="flex-grow overflow-hidden flex flex-col"
              >
                <div className="flex flex-col items-center gap-4 h-full">
                  {/* Video container - only contains the video feed */}
                  <div className="relative h-full" ref={containerRef}>
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
                                : getConfidenceColorClass(detection.confidence)
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
                  <div className="w-full sm:w-[90%] md:w-[75%]">
                    {webcamControls}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </ResizablePanel>

          <ResizableHandle className="bg-border h-2 hover:bg-accent hover:h-2 rounded-sm transition-all data-[dragging=true]:bg-accent" />

          <ResizablePanel defaultSize={30} minSize={20}>
            <div className="h-full flex flex-col gap-4 overflow-hidden">
              {metadata && (
                <div className="flex flex-wrap gap-2 bg-muted p-2 rounded-md flex-shrink-0">
                  <div className="flex items-center gap-1">
                    <Maximize2 size={16} className="text-muted-foreground" />
                    <span className="text-xs font-medium">
                      {metadata.width} × {metadata.height}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock size={16} className="text-muted-foreground" />
                    <span className="text-xs font-medium">
                      {typeof metadata.inferenceTime === "number"
                        ? metadata.inferenceTime.toFixed(1)
                        : metadata.inferenceTime}{" "}
                      FPS
                    </span>
                  </div>
                  {scaledDetections.length > 0 && (
                    <div className="flex items-center gap-1">
                      <Tag size={16} className="text-muted-foreground" />
                      <span className="text-xs font-medium">
                        {scaledDetections.length}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {scaledDetections.length > 0 && (
                <div className="flex-grow overflow-hidden flex flex-col">
                  <div className="flex items-center gap-1 px-2 py-1.5 bg-background sticky top-0 z-20 border-b">
                    <Activity size={16} />
                    <span className="text-sm font-semibold">
                      Detection Results
                    </span>
                  </div>
                  <div className="overflow-auto flex-grow relative">
                    <Table className="w-full text-xs border-separate border-spacing-0">
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="h-8 px-1.5 text-left align-middle border-b font-medium">
                            #
                          </TableHead>
                          <TableHead className="h-8 px-1.5 text-left align-middle border-b font-medium">
                            x-min
                          </TableHead>
                          <TableHead className="h-8 px-1.5 text-left align-middle border-b font-medium">
                            y-min
                          </TableHead>
                          <TableHead className="h-8 px-1.5 text-left align-middle border-b font-medium">
                            x-max
                          </TableHead>
                          <TableHead className="h-8 px-1.5 text-left align-middle border-b font-medium">
                            y-max
                          </TableHead>
                          <TableHead className="h-8 px-1.5 text-left align-middle border-b font-medium">
                            conf
                          </TableHead>
                          <TableHead className="h-8 px-1.5 text-left align-middle border-b font-medium">
                            id
                          </TableHead>
                          <TableHead className="h-8 px-1.5 text-left align-middle border-b font-medium">
                            name
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scaledDetections.map((detection, index) => (
                          <TableRow
                            key={index}
                            className={`cursor-pointer ${
                              index === hoveredIndex ? "bg-blue-100" : ""
                            }`}
                            onMouseEnter={() => handleHoverDetection(index)}
                            onMouseLeave={() => handleHoverDetection(null)}
                          >
                            <TableCell className="p-1.5 align-middle">
                              {index}
                            </TableCell>
                            <TableCell className="p-1.5 align-middle">
                              {detection.xmin?.toFixed(2)}
                            </TableCell>
                            <TableCell className="p-1.5 align-middle">
                              {detection.ymin?.toFixed(2)}
                            </TableCell>
                            <TableCell className="p-1.5 align-middle">
                              {detection.xmax?.toFixed(2)}
                            </TableCell>
                            <TableCell className="p-1.5 align-middle">
                              {detection.ymax?.toFixed(2)}
                            </TableCell>
                            <TableCell
                              className={`p-1.5 align-middle font-medium ${getConfidenceTextColorClass(detection.confidence)}`}
                            >
                              {(detection.confidence * 100).toFixed(1)}%
                            </TableCell>
                            <TableCell className="p-1.5 align-middle">
                              {detection.class}
                            </TableCell>
                            <TableCell className="p-1.5 align-middle font-medium">
                              {detection.name}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Card>
    </div>
  );
};
