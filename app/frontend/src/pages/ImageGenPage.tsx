// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import ImageGenParentComponent from "../components/imageGen/ImageGenParentComponent";

const ImageGenPage = () => {
  return (
    <>
      <div className="h-screen w-full relative flex items-center justify-center">
        <div className="flex grow justify-center items-center w-full h-screen ">
          <ImageGenParentComponent />
        </div>
      </div>
    </>
  );
};

export default ImageGenPage;
