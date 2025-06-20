// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import { RotateCcw } from "lucide-react";

interface CameraDevice {
  deviceId: string;
  label: string;
  kind: string;
}

interface CameraSwitcherProps {
  availableCameras: CameraDevice[];
  currentCameraId: string;
  onSwitchCamera: (deviceId: string) => void;
  isCapturing: boolean;
  className?: string;
}

export const CameraSwitcher: React.FC<CameraSwitcherProps> = ({
  availableCameras,
  currentCameraId,
  onSwitchCamera,
  isCapturing,
  className = "",
}) => {
  // Don't show if only one camera or not capturing
  if (availableCameras.length <= 1 || !isCapturing) {
    return null;
  }

  const handleQuickSwitch = () => {
    // Quick switch between cameras (useful for front/back on mobile)
    const currentIndex = availableCameras.findIndex(
      camera => camera.deviceId === currentCameraId
    );
    const nextIndex = (currentIndex + 1) % availableCameras.length;
    onSwitchCamera(availableCameras[nextIndex].deviceId);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* Quick switch button (good for mobile front/back) */}
      <button
        onClick={handleQuickSwitch}
        className="flex items-center gap-1 px-3 py-2 bg-background/80 hover:bg-background border rounded-md transition-colors text-sm"
        title="Switch Camera"
      >
        <RotateCcw size={16} />
        <span className="hidden sm:inline">Switch</span>
      </button>

      {/* Dropdown for multiple cameras (good for desktop) */}
      {availableCameras.length > 2 && (
        <select
          value={currentCameraId}
          onChange={(e) => onSwitchCamera(e.target.value)}
          className="px-3 py-2 bg-background/80 hover:bg-background border rounded-md transition-colors text-sm min-w-0 max-w-[150px] truncate"
        >
          {availableCameras.map((camera) => (
            <option key={camera.deviceId} value={camera.deviceId}>
              {camera.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

export default CameraSwitcher;