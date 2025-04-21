// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { ObjectDetectionComponent } from "../components/object_detection/ObjectDetectionComponent";

const ObjectDetectionPage = () => {
  return (
    <div className="min-h-screen w-full flex flex-col overflow-hidden">
      {/* Main container with proper viewport constraints */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-7xl h-[calc(100vh-2rem)] flex items-center justify-center">
          <ObjectDetectionComponent />
        </div>
      </div>
    </div>
  );
};

export default ObjectDetectionPage;
