// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
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

export const ObjectDetectionComponent: React.FC = () => {
  const [image, setImage] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [metadata, setMetadata] = useState<DetectionMetadata | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);

  const handleSetImage = useCallback((imageSrc: string | null) => {
    setImage(imageSrc);
  }, []);

  const handleSetDetections = useCallback(
    (data: { boxes: Detection[]; metadata: DetectionMetadata }) => {
      setDetections(Array.isArray(data.boxes) ? data.boxes : []);
      setMetadata(data.metadata);
    },
    [],
  );

  const handleSetLiveMode = useCallback((mode: boolean) => {
    setIsLiveMode(mode);
  }, []);

  useEffect(() => {
    let animationFrameId: number;

    const updatePositions = () => {
      setDetections((prevDetections) =>
        updateBoxPositions(containerRef, null, metadata, prevDetections),
      );

      if (isLiveMode) {
        animationFrameId = requestAnimationFrame(updatePositions);
      }
    };

    if (isLiveMode || detections.length > 0) {
      updatePositions();
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isLiveMode, detections, metadata]);

  return (
    <div className="flex flex-col overflow-scroll h-full gap-8 w-3/4 mx-auto max-w-7xl px-4 md:px-8 py-10">
      <Card className="border-2 p-4 rounded-md space-y-4">
        <Tabs defaultValue="webcam" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="file">File Upload</TabsTrigger>
            <TabsTrigger value="webcam">Webcam</TabsTrigger>
          </TabsList>
          <TabsContent value="file">
            <SourcePicker setImage={handleSetImage} />
          </TabsContent>
          <TabsContent value="webcam" className="h-full">
            <div className="h-full flex flex-col">
              <WebcamPicker
                setDetections={handleSetDetections}
                setLiveMode={handleSetLiveMode}
                setIsLoading={setIsLoading}
                setIsStreaming={setIsStreaming}
                setIsCameraOn={setIsCameraOn}
              />
              {isLiveMode && (
                <div className="flex-grow relative">
                  {/* Bounding boxes will be rendered here */}
                  {detections.map((detection, index) => (
                    <div
                      key={index}
                      className="absolute border-2 border-red-500 pointer-events-none z-20"
                      style={{
                        left: `${detection.scaledXmin ?? detection.xmin}px`,
                        top: `${detection.scaledYmin ?? detection.ymin}px`,
                        width: `${detection.scaledWidth ?? detection.xmax - detection.xmin}px`,
                        height: `${detection.scaledHeight ?? detection.ymax - detection.ymin}px`,
                      }}
                    >
                      <span className="absolute top-0 left-0 bg-red-500 text-white text-xs px-1">
                        {detection.name} ({detection.confidence.toFixed(4)})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {metadata && (
          <div className="text-sm text-gray-500">
            Input image width and height: {metadata.width} x {metadata.height}
            <br />
            Time to inference: {metadata.inferenceTime} sec
          </div>
        )}

        <div
          ref={containerRef}
          className="relative w-full aspect-video bg-black flex items-center justify-center"
        >
          {!isLiveMode && image && (
            <img
              src={image}
              alt="Uploaded"
              className="absolute inset-0 w-full h-full object-contain z-10"
            />
          )}
        </div>

        {detections.length > 0 && (
          <Card className="p-4 mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Index</TableHead>
                  <TableHead>xmin</TableHead>
                  <TableHead>ymin</TableHead>
                  <TableHead>xmax</TableHead>
                  <TableHead>ymax</TableHead>
                  <TableHead>confidence</TableHead>
                  <TableHead>class</TableHead>
                  <TableHead>name</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detections.map((detection, index) => (
                  <TableRow key={index}>
                    <TableCell>{index}</TableCell>
                    <TableCell>{detection.xmin.toFixed(4)}</TableCell>
                    <TableCell>{detection.ymin.toFixed(4)}</TableCell>
                    <TableCell>{detection.xmax.toFixed(4)}</TableCell>
                    <TableCell>{detection.ymax.toFixed(4)}</TableCell>
                    <TableCell>{detection.confidence.toFixed(4)}</TableCell>
                    <TableCell>{detection.class}</TableCell>
                    <TableCell>{detection.name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </Card>
    </div>
  );
};
