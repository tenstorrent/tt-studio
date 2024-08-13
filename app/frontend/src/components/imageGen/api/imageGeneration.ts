// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// Dummy image generation function
export const dummyImageGeneration = async (prompt: string): Promise<string> => {
  console.log(`Generating dummy image based on: "${prompt}"`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return `https://picsum.photos/seed/${Math.random()}/1024/1024`;
};

interface ImageGenerationOptions {
  useLocalModel?: boolean;
  localModelUrl?: string;
}
/*
 TODO:
 Implement the logic to send the model ID from the models deployed page/table to get it here and send it via the POST to the backend.
*/
// TODO : possibly change the POST here based on what the model server expects

//  Modify this to send the POST to the local hosted model server
export const generateImage = async (
  prompt: string,
  options: ImageGenerationOptions = {}
): Promise<string> => {
  const { useLocalModel = false, localModelUrl = "/models-api/inference/" } =
    options;

  if (useLocalModel) {
    return generateImageLocal(prompt, localModelUrl);
  } else {
    ///* this is currently using Stability AI, but you can modify this to use any local server
    return generateImageStabilityAI(prompt);
  }
};

const generateImageStabilityAI = async (prompt: string): Promise<string> => {
  const engineId = "stable-diffusion-xl-1024-v1-0";
  const apiHost = import.meta.env.VITE_API_HOST ?? "https://api.stability.ai";
  const apiKey = import.meta.env.VITE_STABILITY_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing Stability API key. Make sure VITE_STABILITY_API_KEY is set in your environment."
    );
  }

  try {
    const response = await fetch(
      `${apiHost}/v1/generation/${engineId}/text-to-image`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          text_prompts: [{ text: prompt }],
          cfg_scale: 7,
          height: 1024,
          width: 1024,
          samples: 1,
          steps: 30,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Stability AI API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data && data.artifacts && data.artifacts.length > 0) {
      const image = data.artifacts[0];
      return `data:image/png;base64,${image.base64}`;
    } else {
      throw new Error("No image data in the response");
    }
  } catch (error) {
    console.error("Error generating image with Stability AI:", error);
    throw new Error("Failed to generate image with Stability AI");
  }
};

const generateImageLocal = async (
  prompt: string,
  localModelUrl: string
): Promise<string> => {
  try {
    const response = await fetch(localModelUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      throw new Error(`Local model API error: ${response.statusText}`);
    }

    const data = await response.json();

    if (data && data.image) {
      return data.image;
    } else {
      throw new Error("No image data in the local model response");
    }
  } catch (error) {
    console.error("Error generating image with local model:", error);
    throw new Error("Failed to generate image with local model");
  }
};
