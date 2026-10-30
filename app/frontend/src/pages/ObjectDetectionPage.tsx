// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import { ObjectDetectionComponent } from "../components/object_detection/ObjectDetectionComponent";
import { ModelToolbar } from "@/src/vesper/components/model-toolbar";
import { useHealthyModels } from "@/src/vesper/hooks/use-healthy-models";

const ObjectDetectionPage = () => {
  const { models, isLoading, selected, setSelectedId } = useHealthyModels([
    "object_detection",
    "cnn",
  ]);

  return (
    <div className="h-full flex flex-col">
      <ModelToolbar
        models={models}
        isLoading={isLoading}
        value={selected?.id ?? null}
        onChange={setSelectedId}
        emptyText="No object detection model is ready."
      />
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="min-h-screen w-full flex flex-col overflow-hidden">
          {/* Main container with proper viewport constraints */}
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="w-full max-w-7xl h-[calc(100vh-2rem)] flex items-center justify-center">
              <ObjectDetectionComponent modelID={selected?.id ?? null} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ObjectDetectionPage;
