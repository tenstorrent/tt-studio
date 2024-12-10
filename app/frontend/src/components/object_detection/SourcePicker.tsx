// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { Button } from "../ui/button"; // shadcn button

const SourcePicker = ({ setImage }) => {
  const handleImageUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setImage(imageUrl);
    }
  };

  const handleLiveView = () => {
    alert("Live View clicked! Implement functionality.");
  };

  return (
    <div className="flex justify-between items-center">
      <Button
        variant="secondary"
        onClick={() => document.getElementById("imageUpload")?.click()}
      >
        Upload Image
      </Button>
      <input
        type="file"
        id="imageUpload"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />
      <Button onClick={handleLiveView}>Live View</Button>
    </div>
  );
};

export default SourcePicker;
