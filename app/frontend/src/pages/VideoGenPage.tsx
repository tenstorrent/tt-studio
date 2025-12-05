// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import VideoGenParentComponent from "../components/videoGen/VideoGenParentComponent";

const VideoGenPage = () => {
  return (
    <div className="h-screen w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2] overflow-hidden">
      <div
        className="absolute pointer-events-none inset-0 dark:bg-black bg-white"
        style={{
          maskImage:
            "radial-gradient(ellipse at center, transparent 95%, black 100%)",
        }}
      ></div>
      <div className="relative w-full h-full">
        <VideoGenParentComponent />
      </div>
    </div>
  );
};

export default VideoGenPage;
