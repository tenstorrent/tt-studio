// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { Video } from "lucide-react";
import { Button } from "../ui/button"; // shadcn button
import { FileUpload } from "../ui/file-upload";

const SourcePicker = ({ setImage }) => {
  const handleFileUpload = (files: File[]) => {
    const file = files[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setImage(imageUrl);
    }
  };

  const handleLiveView = () => {
    alert("Live View clicked! Implement functionality.");
  };

  return (
    <div className="flex justify-between items-center mx-12">
      <FileUpload onChange={handleFileUpload} />
      <div className="flex-grow">
        <Button
          variant="secondary"
          className="flex space-x-2 h-16 w-[100%]"
          onClick={handleLiveView}
        >
          <Video></Video>
          <span>Start WebCam</span>
        </Button>
      </div>
    </div>
  );
};

export default SourcePicker;
