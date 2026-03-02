// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ImageClassificationComponent } from "../components/image_classification/ImageClassificationComponent";

const ImageClassificationPage = () => {
  return (
    <div className="min-h-screen w-full flex flex-col overflow-hidden">
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-7xl h-[calc(100vh-2rem)] flex items-center justify-center">
          <ImageClassificationComponent />
        </div>
      </div>
    </div>
  );
};

export default ImageClassificationPage;
