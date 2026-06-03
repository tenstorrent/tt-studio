// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";

export const generateVideo = async (
  prompt: string,
  modelID: string,
  localModelUrl = "/models-api/video-generation/"
): Promise<string> => {
  try {
    const formData = new FormData();
    formData.append("deploy_id", modelID);
    formData.append("prompt", prompt);

    const response = await axios.post(localModelUrl, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      responseType: "blob",
      timeout: 360000, // 6 min — video gen + poll can take up to 300s
    });

    if (response.status < 200 || response.status > 299) {
      throw new Error(`Video API error: ${response.statusText}`);
    }

    return URL.createObjectURL(response.data);
  } catch (error) {
    console.error("Error generating video:", error);
    throw new Error("Failed to generate video");
  }
};

export const generateVideoI2V = async (
  prompt: string,
  imageFile: File,
  modelID: string,
  localModelUrl = "/models-api/video-generation-i2v/"
): Promise<string> => {
  try {
    const formData = new FormData();
    formData.append("deploy_id", modelID);
    formData.append("prompt", prompt);
    formData.append("image", imageFile);

    const response = await axios.post(localModelUrl, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      responseType: "blob",
      timeout: 360000,
    });

    if (response.status < 200 || response.status > 299) {
      throw new Error(`Video I2V API error: ${response.statusText}`);
    }

    return URL.createObjectURL(response.data);
  } catch (error) {
    console.error("Error generating I2V video:", error);
    throw new Error("Failed to generate video from image");
  }
};
