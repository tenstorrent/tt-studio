// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import ImageGenParentComponent from "../components/imageGen/ImageGenParentComponent";
import { ModelToolbar } from "@/src/vesper/components/model-toolbar";
import { useHealthyModels } from "@/src/vesper/hooks/use-healthy-models";

const ImageGenPage = () => {
  const { models, isLoading, selected, setSelectedId } =
    useHealthyModels("image_generation");

  return (
    <div className="h-full flex flex-col">
      <ModelToolbar
        models={models}
        isLoading={isLoading}
        value={selected?.id ?? null}
        onChange={setSelectedId}
        emptyText="No image generation model is ready."
      />
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="h-screen w-full relative flex items-center justify-center">
          <div className="flex grow justify-center items-center w-full h-screen ">
            <ImageGenParentComponent
              modelID={selected?.id ?? null}
              modelName={selected?.modelName ?? null}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageGenPage;
