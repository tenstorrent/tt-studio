/**
 * API client for sending audio recordings to a server
 */
import { convertToWav } from "../waveConverter";

// Configuration type for the API client
export interface ApiConfig {
  // The base URL for the API
  baseUrl: string;
  // Optional authentication token
  authToken?: string;
  // Optional headers to include with requests
  headers?: Record<string, string>;
  // Optional timeout in milliseconds
  timeout?: number;
}

// Default configuration - use the proxy URL to avoid CORS issues
const DEFAULT_CONFIG: ApiConfig = {
  // Use the proxy endpoint defined in vite.config.ts to avoid CORS issues
  baseUrl: "/models-api/speech-recognition/",
  timeout: 30000, // 30 seconds
};

// Current configuration
let currentConfig: ApiConfig = { ...DEFAULT_CONFIG };

/**
 * Configure the API client
 */
export function configureApi(config: Partial<ApiConfig>): void {
  currentConfig = {
    ...currentConfig,
    ...config,
  };
}

/**
 * Get the current API configuration
 */
export function getApiConfig(): ApiConfig {
  return { ...currentConfig };
}

/**
 * Send an audio recording to the server
 */
export async function sendAudioRecording(
  audioBlob: Blob,
  metadata?: Record<string, any>
) {
  try {
    console.log("Original audio blob:", {
      type: audioBlob.type,
      size: audioBlob.size,
    });

    // Convert to WAV format with 16kHz sample rate (required by the API)
    console.log("Converting audio to WAV format with 16kHz sample rate...");
    let processedBlob: Blob;
    try {
      // Always convert to ensure proper format and sample rate
      processedBlob = await convertToWav(audioBlob);
      console.log("Conversion successful:", {
        type: processedBlob.type,
        size: processedBlob.size,
      });
    } catch (error) {
      console.error("Failed to convert to WAV:", error);
      throw new Error("Failed to convert audio to required format");
    }

    // Create form data
    const formData = new FormData();

    // Use "file" parameter name as required by the API
    formData.append("file", processedBlob, "recording.wav");

    // Add metadata if provided
    if (metadata) {
      formData.append("deploy_id", metadata.modelID);
    }

    // Prepare headers
    const headers: HeadersInit = {};

    // Add auth token if available
    if (currentConfig.authToken) {
      headers["Authorization"] = currentConfig.authToken;
    }

    console.log("Auth token present:", !!currentConfig.authToken);
    console.log("Headers:", Object.keys(headers).join(", "));

    // Add custom headers
    if (currentConfig.headers) {
      Object.entries(currentConfig.headers).forEach(([key, value]) => {
        headers[key] = value;
      });
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      currentConfig.timeout
    );

    // Determine which endpoint to use
    const apiUrlDefined = import.meta.env.VITE_ENABLE_DEPLOYED === "true";
    const useCloudEndpoint =
      !metadata?.modelID || metadata.modelID === "null" || apiUrlDefined;
    const endpoint = useCloudEndpoint
      ? "/models-api/speech-recognition-cloud/"
      : "/models-api/speech-recognition/";

    console.log("Sending request to:", endpoint);

    // Make the request
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: formData,
      signal: controller.signal,
    });

    // Clear timeout
    clearTimeout(timeoutId);

    // Parse the response regardless of the status code
    const responseText = await response.text();
    let data;

    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error("Failed to parse response as JSON:", responseText);
      data = { text: "Failed to parse response" };
    }

    // Handle response status
    if (!response.ok) {
      console.error(`API error: ${response.status} ${response.statusText}`);
      console.error("Error details:", responseText);

      // Check if we have an error message in the response
      if (data && data.error) {
        throw new Error(`API error: ${data.error}`);
      }

      throw new Error(`API error: ${response.status}`);
    }

    console.log("API response received:", data);

    // Ensure we have a text property in the response
    if (!data.text && data.transcription) {
      data.text = data.transcription;
    } else if (!data.text) {
      data.text = "Transcription received";
    }

    return data;
  } catch (error) {
    console.error("API client error:", error);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  }
}
