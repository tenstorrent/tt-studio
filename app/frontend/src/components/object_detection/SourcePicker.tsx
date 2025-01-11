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

interface SourcePickerProps {
  containerRef: React.RefObject<HTMLDivElement>;
  setDetections: (data: {
    boxes: Detection[];
    metadata: DetectionMetadata;
  }) => void;
  setLiveMode: (mode: boolean) => void;
  scaledDetections: Detection[];
  modelID: string;
}

const SourcePicker: React.FC<SourcePickerProps> = ({
  containerRef,
  setDetections,
  setLiveMode,
  scaledDetections,
  modelID,
}) => {
  const [image, setImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const handleSetImage = useCallback((imageSrc: string | null) => {
    setImage(imageSrc);
  }, []);

  const handleFileUpload = async (files: File[]) => {
    const file = files[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setImageFile(file);
      handleSetImage(imageUrl);
    }
  };

  useEffect(() => {
    if (imageFile && imageRef.current) {
      const request: InferenceRequest = {
        deploy_id: modelID,
        imageSource: imageFile,
      };
      runInference(request, imageRef.current, setDetections);
      // perfrom this if above is successful
      setLiveMode(true);
    }
  }, [image, setDetections, setLiveMode, imageFile, modelID]);

  return (
    <div className="flex flex-col">
      <FileUpload onChange={handleFileUpload} />
      <div ref={containerRef} className="relative">
        {image && (
          <div>
            <img
              ref={imageRef}
              src={image}
              alt="uploaded"
              className="inset-0 w-full object-contain bg-background/95 rounded-lg"
            />
            <div className="absolute inset-0 pointer-events-none">
              {scaledDetections.map((detection, index) => (
                <div
                  key={index}
                  className="absolute border-2 border-red-500 z-20"
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
          </div>
        )}
      </div>
    </div>
  );
};

export default SourcePicker;
