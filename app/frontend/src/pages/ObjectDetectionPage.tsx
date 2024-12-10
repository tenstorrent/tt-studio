// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { ObjectDetectionComponent } from "../components/object_detection/ObjectDetectionComponent";

const ObjectDetectionPage = () => {
  return (
    <>
      <div className="h-screen w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2] relative flex items-center justify-center">
        <div
          className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
          style={{
            maskImage:
              "radial-gradient(ellipse at center, transparent 45%, black 100%)",
          }}
        ></div>
        <div className="flex flex-grow overflow-scroll justify-center items-center w-full h-screen">
          <ObjectDetectionComponent />
        </div>
      </div>
    </>
  );
};

export default ObjectDetectionPage;
