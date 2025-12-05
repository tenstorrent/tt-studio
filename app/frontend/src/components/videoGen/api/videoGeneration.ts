// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios from "axios";

interface VideoGenerationOptions {
  useLocalModel?: boolean;
  localModelUrl?: string;
}

// Generate video using cloud API
export const generateVideo = async (
  prompt: string,
  modelID: string,
  options: VideoGenerationOptions = {}
): Promise<string> => {
  const {
    useLocalModel = true,
    localModelUrl = "/models-api/video-generation-cloud/",
  } = options;

  // Check if we should use cloud endpoints
  const useCloud = import.meta.env.VITE_ENABLE_DEPLOYED === "true";

  if (useLocalModel && useCloud) {
    return generateVideoCloud(prompt, "null", localModelUrl);
  }

  // For now, only cloud generation is supported
  return generateVideoCloud(prompt, modelID, localModelUrl);
};

const generateVideoCloud = async (
  prompt: string,
  modelID: string,
  videoApiUrl: string
): Promise<string> => {
  try {
    // construct FormData to send to API
    const formData = new FormData();
    formData.append("deploy_id", modelID);
    formData.append("prompt", prompt);

    const response = await axios.post(videoApiUrl, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      responseType: "blob",
      timeout: 180000, // 3 minutes timeout for video generation
    });

    if (response.status < 200 || response.status > 299) {
      throw new Error(`Video generation API error: ${response.statusText}`);
    }

    // Create a URL for the Blob data received
    const data = await response.data;
    const videoURL = URL.createObjectURL(data);
    return videoURL;
  } catch (error) {
    console.error("Error generating video with cloud model:", error);
    if (axios.isAxiosError(error) && error.code === "ECONNABORTED") {
      throw new Error(
        "Video generation timed out. This may take a few minutes, please try again."
      );
    }
    throw new Error("Failed to generate video with cloud model");
  }
};
