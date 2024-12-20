// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import axios from "axios";
import { FileUpload } from "../ui/file-upload";
import { useCallback, useState } from "react";

interface SourcePickerProps {
  modelID: string;
}

const SourcePicker: React.FC<SourcePickerProps> = ({ modelID }) => {
  const [image, setImage] = useState<string | null>(null);

  const handleSetImage = useCallback((imageSrc: string | null) => {
    setImage(imageSrc);
  }, []);

  // TODO: Extract into .ts function in separate file
  const handleFileUpload = async (files: File[]) => {
    const file = files[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      handleSetImage(imageUrl);
      // TODO: Get modelID from parent object-detection component
      const formData = new FormData();
      formData.append("image", file);
      formData.append("deploy_id", modelID);
      const response = await axios.post(
        `/models-api/object-detection/`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      );
      const detections = await response.data;
      // TODO: set table data here
      console.log(detections);
    }
  };

  return (
    <div className="flex flex-col">
      <FileUpload onChange={handleFileUpload} />
      {image && (
        <img
          src={image}
          alt="uploaded"
          className="inset-0 w-full h-full object-contain bg-background/95 rounded-lg"
        />
      )}
    </div>
  );
};

export default SourcePicker;
