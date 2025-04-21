// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { FileUpload } from "../ui/file-upload";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Detection,
  DetectionMetadata,
  InferenceRequest,
} from "./types/objectDetection";
import { runInference } from "./utlis/runInference";
import { Button } from "../ui/button";
import { X, Upload } from "lucide-react";
import {
  getConfidenceColorClass,
  getLabelColorClass,
} from "./utlis/colorUtils";

interface SourcePickerProps {
  containerRef: React.RefObject<HTMLDivElement>;
  setDetections: (data: {
    boxes: Detection[];
    metadata: DetectionMetadata;
  }) => void;
  setLiveMode: (mode: boolean) => void;
  scaledDetections: Detection[];
  modelID: string | null;
  hoveredIndex?: number | null;
  onHoverDetection?: (index: number | null) => void;
}

const SourcePicker: React.FC<SourcePickerProps> = ({
  containerRef,
  setDetections,
  setLiveMode,
  scaledDetections,
  modelID,
  hoveredIndex,
  onHoverDetection,
}) => {
  const [image, setImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [showUpload, setShowUpload] = useState(true);
  const imageRef = useRef<HTMLImageElement>(null);

  const handleSetImage = useCallback((imageSrc: string | null) => {
    setImage(imageSrc);
    setShowUpload(false);
  }, []);

  const handleFileUpload = async (files: File[]) => {
    const file = files[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setImageFile(file);
      handleSetImage(imageUrl);
    }
  };

  const handleRemoveImage = () => {
    // Add pulse animation to the button container
    const buttonContainer = document.querySelector("[data-remove-button]");
    if (buttonContainer) {
      buttonContainer.classList.add("animate-pulse");
      setTimeout(() => {
        if (image) {
          URL.revokeObjectURL(image);
        }
        setImage(null);
        setImageFile(null);
        setShowUpload(true);
        setLiveMode(false);
        setDetections({
          boxes: [],
          metadata: { width: 0, height: 0, inferenceTime: 0 },
        });
      }, 200);
    }
  };

  useEffect(() => {
    if (imageFile && imageRef.current) {
      const request: InferenceRequest = {
        deploy_id: modelID,
        imageSource: imageFile,
      };
      runInference(request, imageRef.current, setDetections);
      setLiveMode(true);
    }
  }, [image, setDetections, setLiveMode, imageFile, modelID]);

  return (
    <div className="h-full flex flex-col p-4 border rounded-xl bg-background/50 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-4 p-2 rounded-lg border border-muted/10 hover:border-muted/50 bg-muted/5 hover:bg-background/80 transition-all duration-300 ease-in-out transform hover:scale-[1.01] hover:shadow-md group/header">
        {!showUpload && imageFile && (
          <span className="text-sm text-muted-foreground/40 group-hover/header:text-foreground transition-all duration-300 ease-in-out truncate px-2 hover:translate-x-0.5">
            {imageFile.name}
          </span>
        )}
        <div className="flex gap-2">
          {!showUpload && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRemoveImage}
              data-remove-button
              className="group flex items-center gap-2 hover:bg-destructive/10 transition-all duration-300 ease-in-out transform hover:-translate-x-0.5 hover:shadow-md"
            >
              <X
                size={16}
                className="text-destructive opacity-80 scale-75 group-hover:scale-100 group-hover:opacity-100 transition-all duration-300 ease-in-out"
              />
              <span className="text-muted-foreground/50 group-hover:text-destructive transition-all duration-300 ease-in-out group-hover:font-medium">
                Remove Image
              </span>
            </Button>
          )}
        </div>
      </div>

      {showUpload ? (
        <div className="flex-1 flex items-center justify-center bg-muted/10 rounded-lg p-8 border border-dashed">
          <FileUpload onChange={handleFileUpload} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 relative bg-muted/5 rounded-lg p-4">
          <div
            ref={containerRef}
            className="h-full flex items-center justify-center"
          >
            {image && (
              <div className="relative max-h-full">
                <img
                  ref={imageRef}
                  src={image}
                  alt="uploaded"
                  className="max-h-[calc(100vh-16rem)] w-auto object-contain bg-background/95 rounded-lg shadow-sm"
                />
                <div className="absolute inset-0 pointer-events-none">
                  {scaledDetections.map((detection, index) => (
                    <div
                      key={index}
                      className={`absolute border-2 ${
                        index === hoveredIndex
                          ? "border-blue-500 bg-blue-500/30 shadow-lg"
                          : getConfidenceColorClass(detection.confidence)
                      } z-20 rounded-sm pointer-events-auto`}
                      style={{
                        left: `${detection.scaledXmin ?? detection.xmin}px`,
                        top: `${detection.scaledYmin ?? detection.ymin}px`,
                        width: `${detection.scaledWidth ?? detection.xmax - detection.xmin}px`,
                        height: `${detection.scaledHeight ?? detection.ymax - detection.ymin}px`,
                      }}
                      onMouseEnter={() => onHoverDetection?.(index)}
                      onMouseLeave={() => onHoverDetection?.(null)}
                    >
                      <span
                        className={`absolute top-0 left-0 ${getLabelColorClass(
                          detection.confidence
                        )} text-white text-xs px-1 py-0.5 rounded-br-sm truncate max-w-full`}
                      >
                        {detection.name} ({detection.confidence.toFixed(2)})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SourcePicker;
