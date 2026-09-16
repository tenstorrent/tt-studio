// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import OcrApp from "../components/ocr/OcrApp";

const OcrPage = () => {
  return (
    <div className="h-screen w-full dark:bg-[#0A0A0A] bg-[#FAFAFA]">
      <div className="w-full h-screen pt-16 md:pt-0">
        <OcrApp />
      </div>
    </div>
  );
};

export default OcrPage;
