// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import VideoGenI2VParentComponent from "../components/videoGen/VideoGenI2VParentComponent";

const VideoGenI2VPage = () => {
  return (
    <>
      <div className="h-screen w-full relative flex items-center justify-center">
        <div className="flex grow justify-center items-center w-full h-screen">
          <VideoGenI2VParentComponent />
        </div>
      </div>
    </>
  );
};

export default VideoGenI2VPage;
