// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import axios from "axios";
import { FileUpload } from "../ui/file-upload";

interface SourcePickerProps {
  setImage: (imageSrc: string | null) => void;
  modelID: string;
}

const SourcePicker: React.FC<SourcePickerProps> = ({ setImage, modelID }) => {
  // TODO: Extract into .ts function in separate file
  const handleFileUpload = async (files: File[]) => {
    const file = files[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setImage(imageUrl);
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
    <div className="flex justify-center items-center">
      <FileUpload onChange={handleFileUpload} />
    </div>
  );
};

export default SourcePicker;
