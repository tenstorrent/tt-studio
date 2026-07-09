// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import VideoGenParentComponent from "../components/videoGen/VideoGenParentComponent";

const VideoGenPage = () => {
  return (
    <>
      <div className="h-screen w-full relative flex items-center justify-center">
        <div className="flex grow justify-center items-center w-full h-screen">
          <VideoGenParentComponent />
        </div>
      </div>
    </>
  );
};

export default VideoGenPage;
