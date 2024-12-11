// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { FileUpload } from "../ui/file-upload";

interface SourcePickerProps {
  setImage: (imageSrc: string | null) => void;
}

const SourcePicker: React.FC<SourcePickerProps> = ({ setImage }) => {
  const handleFileUpload = (files: File[]) => {
    const file = files[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setImage(imageUrl);
    }
  };

  return (
    <div className="flex justify-center items-center">
      <FileUpload onChange={handleFileUpload} />
    </div>
  );
};

export default SourcePicker;
