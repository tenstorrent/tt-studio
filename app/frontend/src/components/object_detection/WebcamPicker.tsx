// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { useState, useRef, useCallback } from "react";
import Webcam from "react-webcam";
import { Button } from "../ui/button";

interface WebcamPickerProps {
  setImage: (imageSrc: string | null) => void;
}

const WebcamPicker: React.FC<WebcamPickerProps> = ({ setImage }) => {
  const [isCapturing, setIsCapturing] = useState(false);
  const webcamRef = useRef<Webcam>(null);

  const handleStartCapture = useCallback(() => {
    setIsCapturing(true);
  }, []);

  const handleCapture = useCallback(() => {
    if (webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      setImage(imageSrc);
      setIsCapturing(false);
    }
  }, [setImage]);

  const handleStopCapture = useCallback(() => {
    setIsCapturing(false);
  }, []);

  return (
    <div className="flex flex-col items-center space-y-4">
      {isCapturing ? (
        <>
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            className="w-full max-w-md rounded-md"
          />
          <div className="flex space-x-2">
            <Button onClick={handleCapture}>Capture</Button>
            <Button onClick={handleStopCapture} variant="outline">
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button onClick={handleStartCapture} className="w-full max-w-md">
          Start Webcam
        </Button>
      )}
    </div>
  );
};

export default WebcamPicker;
