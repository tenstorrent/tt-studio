// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import VideoGenParentComponent from "../components/videoGen/VideoGenParentComponent";

const VideoGenPage = () => {
  return (
    <div className="fixed inset-0 w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2] lg:pl-16">
      <div
        className="absolute pointer-events-none inset-0 dark:bg-black bg-white"
        style={{
          maskImage:
            "radial-gradient(ellipse at center, transparent 95%, black 100%)",
        }}
      ></div>
      <div className="w-full h-full overflow-hidden pb-20">
        <VideoGenParentComponent />
      </div>
    </div>
  );
};

export default VideoGenPage;
