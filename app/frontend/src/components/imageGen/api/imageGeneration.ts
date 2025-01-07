import axios from 'axios';

export const generateImage = async (prompt: string): Promise<string> => {
  const engineId = 'stable-diffusion-xl-1024-v1-0';
  const apiHost = import.meta.env.VITE_API_HOST ?? 'https://api.stability.ai';
  const apiKey = import.meta.env.VITE_STABILITY_API_KEY;

  if (!apiKey) throw new Error("Missing Stability API key. Make sure VITE_STABILITY_API_KEY is set in your environment.");

  try {
    const response = await axios.post(
      `${apiHost}/v1/generation/${engineId}/text-to-image`,
      {
        text_prompts: [{ text: prompt }],
        cfg_scale: 7,
        height: 1024,
        width: 1024,
        samples: 1,
        steps: 30,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (response.data && response.data.artifacts && response.data.artifacts.length > 0) {
      const image = response.data.artifacts[0];
      return `data:image/png;base64,${image.base64}`;
    } else {
      throw new Error('No image data in the response');
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Axios error:', error.response?.data || error.message);
      throw new Error(`API error: ${error.response?.data?.message || error.message}`);
    } else {
      console.error('Error generating image:', error);
      throw new Error('Failed to generate image');
    }
  }
};

