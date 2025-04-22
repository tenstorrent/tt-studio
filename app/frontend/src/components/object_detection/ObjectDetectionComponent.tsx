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

export const ObjectDetectionComponent: React.FC = () => {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [scaledDetections, setScaledDetections] = useState<Detection[]>([]);
  const [metadata, setMetadata] = useState<DetectionMetadata | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);
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
      {/* Removed overflow-scroll from parent container and set max height */}
      <Card className="border-2 p-4 rounded-md space-y-4 h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
        <Tabs
          defaultValue="webcam"
          className="w-full"
          onValueChange={(value) => {
            // Clear detections when switching tabs
            setDetections([]);
            setScaledDetections([]);
            setMetadata(null);
            setIsLiveMode(false);
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
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
            className="flex-grow overflow-hidden flex flex-col"
          >
            <div className="relative flex flex-col flex-grow">
              <SourcePicker
                containerRef={containerRef}
                setDetections={handleSetDetections}
                setLiveMode={handleSetLiveMode}
                scaledDetections={scaledDetections}
                modelID={modelID}
              />
            </div>
          </TabsContent>
          <TabsContent
            value="webcam"
            className="flex-grow overflow-hidden flex flex-col"
          >
            <div className="relative flex flex-col flex-grow">
              <WebcamPicker
                setDetections={handleSetDetections}
                setLiveMode={handleSetLiveMode}
                setIsLoading={setIsLoading}
                setIsStreaming={setIsStreaming}
                setIsCameraOn={setIsCameraOn}
                modelID={modelID}
                setExternalControls={null}
                videoOnly={false}
              />
              <div 
                ref={containerRef} 
                className="absolute inset-0 pointer-events-none z-20"
              >
                {isLiveMode && (
                  <div className="absolute inset-0 pointer-events-none">
                    {scaledDetections.map((detection, index) => (
                      <div
                        key={index}
                        className={`absolute border-2 ${getConfidenceColorClass(detection.confidence)} z-20 rounded-sm`}
                        style={{
                          left: `${detection.scaledXmin ?? detection.xmin}px`,
                          top: `${detection.scaledYmin ?? detection.ymin}px`,
                          width: `${detection.scaledWidth ?? detection.xmax - detection.xmin}px`,
                          height: `${detection.scaledHeight ?? detection.ymax - detection.ymin}px`,
                          transition: "all 0.1s ease-in-out",
                        }}
                      >
                        <span
                          className={`absolute top-0 left-0 ${getLabelColorClass(detection.confidence)} text-white text-xs px-1 py-0.5 rounded-br-sm truncate max-w-full`}
                        >
                          {detection.name} ({detection.confidence.toFixed(2)})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {metadata && (
          <div className="flex flex-col sm:flex-row gap-4 bg-muted p-3 rounded-md">
            <div className="flex items-center gap-2">
              <Maximize2 size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">
                Dimensions:{" "}
                <span className="font-bold">
                  {metadata.width} × {metadata.height}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">
                FPS:{" "}
                <span className="font-bold">
                  {typeof metadata.inferenceTime === "number"
                    ? metadata.inferenceTime.toFixed(1)
                    : metadata.inferenceTime}
                </span>
              </span>
            </div>
            {scaledDetections.length > 0 && (
              <div className="flex items-center gap-2">
                <Tag size={18} className="text-muted-foreground" />
                <span className="text-sm font-medium">
                  Detections:{" "}
                  <span className="font-bold">{scaledDetections.length}</span>
                </span>
              </div>
            )}
          </div>
        )}

        {scaledDetections.length > 0 && (
          <div className="p-2 sm:p-4 flex-shrink overflow-auto max-h-[calc(40vh-2rem)]">
            <div className="flex items-center gap-2 mb-3 sticky top-0 bg-background py-2 z-10">
              <Activity size={18} />
              <span className="font-semibold">Detection Results</span>
            </div>
            <div className="overflow-x-auto">
              <Table className="text-sm sm:text-base w-full text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-1 sm:px-4 py-2 whitespace-nowrap">
                      #
                    </TableHead>
                    <TableHead className="px-1 sm:px-4 py-2 whitespace-nowrap">
                      x-min
                    </TableHead>
                    <TableHead className="px-1 sm:px-4 py-2 whitespace-nowrap">
                      y-min
                    </TableHead>
                    <TableHead className="px-1 sm:px-4 py-2 whitespace-nowrap">
                      x-max
                    </TableHead>
                    <TableHead className="px-1 sm:px-4 py-2 whitespace-nowrap">
                      y-max
                    </TableHead>
                    <TableHead className="px-1 sm:px-4 py-2 whitespace-nowrap">
                      conf
                    </TableHead>
                    <TableHead className="px-1 sm:px-4 py-2 whitespace-nowrap">
                      id
                    </TableHead>
                    <TableHead className="px-1 sm:px-4 py-2 whitespace-nowrap">
                      name
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scaledDetections.map((detection, index) => (
                    <TableRow key={index}>
                      <TableCell className="px-1 sm:px-4 py-2">
                        {index}
                      </TableCell>
                      <TableCell className="px-1 sm:px-4 py-2">
                        {detection.xmin?.toFixed(2)}
                      </TableCell>
                      <TableCell className="px-1 sm:px-4 py-2">
                        {detection.ymin?.toFixed(2)}
                      </TableCell>
                      <TableCell className="px-1 sm:px-4 py-2">
                        {detection.xmax?.toFixed(2)}
                      </TableCell>
                      <TableCell className="px-1 sm:px-4 py-2">
                        {detection.ymax?.toFixed(2)}
                      </TableCell>
                      <TableCell
                        className={`px-1 sm:px-4 py-2 font-medium ${getConfidenceTextColorClass(detection.confidence)}`}
                      >
                        {detection.confidence?.toFixed(2)}
                      </TableCell>
                      <TableCell className="px-1 sm:px-4 py-2">
                        {detection.class}
                      </TableCell>
                      <TableCell className="px-1 sm:px-4 py-2 font-medium">
                        {detection.name}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
