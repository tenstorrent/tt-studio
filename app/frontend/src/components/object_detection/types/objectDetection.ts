// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
export interface Detection {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  confidence: number;
  class: number;
  name: string;
  scaledXmin?: number;
  scaledYmin?: number;
  scaledWidth?: number;
  scaledHeight?: number;
}

export interface DetectionMetadata {
  width: number;
  height: number;
  inferenceTime: number;
}

export interface WebcamPickerProps {
  setDetections: (data: {
    boxes: Detection[];
    metadata: DetectionMetadata;
  }) => void;
  setLiveMode: (mode: boolean) => void;
  setIsLoading: (isLoading: boolean) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setIsCameraOn: (isCameraOn: boolean) => void;
  modelID: string | null;
  setExternalControls?: (controls: React.ReactNode) => void;
  videoOnly?: boolean;
}
export interface InferenceRequest {
  deploy_id: string;
  imageSource: Blob | File;
}
