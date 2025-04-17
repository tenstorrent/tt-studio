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

// Add color utility functions
const getConfidenceColorClass = (confidence: number) => {
  if (confidence > 0.7) return "border-green-500";
  if (confidence > 0.5) return "border-yellow-500";
  return "border-red-500";
};

const getLabelColorClass = (confidence: number) => {
  if (confidence > 0.7) return "bg-green-500";
  if (confidence > 0.5) return "bg-yellow-500";
  return "bg-red-500";
};

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
    <div className="flex flex-col h-full overflow-hidden">
      {showUpload ? (
        <div className="flex-shrink-0">
          <FileUpload onChange={handleFileUpload} />
        </div>
      ) : (
        <div className="flex-shrink-0 flex justify-between items-center p-2 bg-muted/50 rounded-lg mb-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Upload size={16} />
            <span>{imageFile?.name}</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              onClick={() => setShowUpload(true)}
            >
              Change Image
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-destructive hover:text-destructive"
              onClick={handleRemoveImage}
            >
              <X size={16} />
            </Button>
          </div>
        </div>
      )}
      <div className="flex-grow overflow-auto min-h-0">
        <div ref={containerRef} className="relative">
          {image && (
            <div>
              <img
                ref={imageRef}
                src={image}
                alt="uploaded"
                className="w-full object-contain bg-background/95 rounded-lg"
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
                      className={`absolute top-0 left-0 ${getLabelColorClass(detection.confidence)} text-white text-xs px-1 py-0.5 rounded-br-sm truncate max-w-full`}
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
    </div>
  );
};

export default SourcePicker;
