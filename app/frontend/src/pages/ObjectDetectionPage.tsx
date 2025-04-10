// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { ObjectDetectionComponent } from "../components/object_detection/ObjectDetectionComponent";

const ObjectDetectionPage = () => {
  return (
    <>
      <div className="min-h-screen pt-16 md:pt-0 w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2] relative flex items-center justify-center">
        <div
          className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
          style={{
            maskImage:
              "radial-gradient(ellipse at center, transparent 45%, black 100%)",
          }}
        ></div>
        <div
          className="flex flex-grow justify-center items-center w-full h-full"
          // hack to prevent maskImage from applying to neighbor div
          style={{ zIndex: 1 }}
        >
          <ObjectDetectionComponent />
        </div>
      </div>
    </>
  );
};

export default ObjectDetectionPage;
