// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";
import { customToast } from "../components/CustomToaster";
import { NavigateFunction } from "react-router-dom";
import { type Model } from "../contexts/ModelsContext";

const dockerAPIURL = "/docker-api/";
const modelAPIURL = "/models-api/";
const statusURl = `${dockerAPIURL}status/`;
const stopModelsURL = `${dockerAPIURL}stop/`;
const deployedModelsURL = `${modelAPIURL}deployed/`;

interface PortBinding {
  HostIp: string;
  HostPort: string;
}

interface Network {
  DNSNames: string[];
}

interface ContainerData {
  name: string;
  status: string;
  health: string;
  create: string;
  image_id: string;
  image_name: string;
  port_bindings: { [key: string]: PortBinding[] };
  networks: { [key: string]: Network };
  device_id?: number | null;
  /** Set when status is enriched from deploy cache; used for navbar routing. */
  model_type?: string;
}

interface StopResponse {
  status: string;
  stop_response: {
    status: string;
    output?: string;
  };
  reset_response?: {
    status: string;
    output?: string;
  };
}

interface DeployedModelInfo {
  id: string;
  modelName: string;
  status: string;
  model_type?: string;
  internal_url?: string;
  health_url?: string;
  max_model_len?: number | null;
  model_impl?: {
    model_name?: string;
    hf_model_id?: string;
    model_type?: string;
    param_count?: number | null;
  };
}

export const ModelType = {
  ChatModel: "ChatModel",
  VLM: "VLM",
  ImageGeneration: "ImageGeneration",
  VideoGeneration: "VideoGeneration",
  ObjectDetectionModel: "ObjectDetectionModel",
  SpeechRecognitionModel: "SpeechRecognitionModel",
  ImageClassificationModel: "ImageClassificationModel",
  FaceRecognitionModel: "FaceRecognitionModel",
  TTS: "TTS",
  Embedding: "Embedding",
  CNN: "CNN",
};

/**
 * Map backend model_type strings (from catalog/API) to frontend ModelType constants.
 * Normalizes casing so values like SPEECH_RECOGNITION still map correctly.
 * Falls back to ChatModel for unknown types.
 */
export const getModelTypeFromBackendType = (backendType: string): string => {
  const normalized = String(backendType ?? "").toLowerCase();
  switch (normalized) {
    case "chat":
      return ModelType.ChatModel;
    case "vlm":
      return ModelType.VLM;
    case "image_generation":
      return ModelType.ImageGeneration;
    case "video_generation":
      return ModelType.VideoGeneration;
    case "object_detection":
      return ModelType.ObjectDetectionModel;
    case "speech_recognition":
      return ModelType.SpeechRecognitionModel;
    case "image_classification":
      return ModelType.ImageClassificationModel;
    case "face_recognition":
      return ModelType.FaceRecognitionModel;
    case "tts":
      return ModelType.TTS;
    case "embedding":
      return ModelType.Embedding;
    case "cnn":
      return ModelType.CNN;
    default:
      return ModelType.ChatModel;
  }
};

export const fetchModels = async (): Promise<Model[]> => {
  try {
    console.log(`Fetching models from ${statusURl}`);
    const response = await axios.get<{ [key: string]: ContainerData }>(
      statusURl,
      {
        timeout: 10000, // 10 second timeout
        headers: { "Cache-Control": "no-cache" },
      }
    );

    if (!response.data) {
      console.error("Received empty response data");
      throw new Error("Empty response from server");
    }

    const data = response.data;
    console.log("Raw response data:", data);

    if (Object.keys(data).length === 0) {
      console.log("No containers found in response");
      return [];
    }

    const models: Model[] = Object.keys(data).map((key) => {
      const container = data[key];

      // Handle possible null port_bindings
      let portMapping = "No ports";
      if (
        container.port_bindings &&
        Object.keys(container.port_bindings).length > 0
      ) {
        portMapping = Object.keys(container.port_bindings)
          .filter((port) => container.port_bindings[port] !== null)
          .map((port) => {
            if (!container.port_bindings[port]) {
              return `${port} (unbound)`;
            }
            return `${container.port_bindings[port][0].HostIp}:${container.port_bindings[port][0].HostPort}->${port}`;
          })
          .join(", ");
      }

      return {
        id: key,
        image: container.image_name || "Unknown image",
        status: container.status || "unknown",
        health: container.health || "unknown",
        ports: portMapping,
        name: container.name || "Unnamed container",
        device_id: container.device_id ?? null,
        model_type: container.model_type,
      };
    });

    console.log("Processed models:", models);
    return models;
  } catch (error) {
    console.error("Error fetching models:", error);
    if (axios.isAxiosError(error)) {
      if (error.code === "ECONNABORTED") {
        customToast.error("Request timeout: Server took too long to respond");
      } else if (error.response) {
        customToast.error(
          `Server error: ${error.response.status} ${error.response.statusText}`
        );
      } else if (error.request) {
        customToast.error("Network error: No response received from server");
      } else {
        customToast.error(`Request error: ${error.message}`);
      }
    } else {
      customToast.error(
        `Failed to fetch models: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
    throw error;
  }
};

export const deleteModel = async (modelId: string): Promise<StopResponse> => {
  const payload = JSON.stringify({ container_id: modelId });

  const response = await axios.post<StopResponse>(stopModelsURL, payload, {
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (
    response.data.status !== "success" ||
    !response.data.stop_response ||
    response.data.stop_response.status !== "success"
  ) {
    throw new Error("Failed to stop the container");
  }

  return response.data;
};

export const handleRedeploy = (modelName: string): void => {
  customToast.success(`Model ${modelName} has been redeployed.`);
};

export const handleModelNavigationClick = (
  modelID: string,
  modelName: string,
  navigate: NavigateFunction,
  modelType?: string
): void => {
  const resolvedModelType = modelType ?? getModelTypeFromName(modelName);
  const destination = getDestinationFromModelType(resolvedModelType);
  console.log(`${resolvedModelType} button clicked for model: ${modelID}`);
  console.log(`Opening ${resolvedModelType} for model: ${modelName}`);
  customToast.success(`${destination.slice(1)} page opened!`);

  navigate(destination, {
    state: { containerID: modelID, modelName: modelName },
  });

  console.log(`Navigated to ${destination} page`);
};

export const getDestinationFromModelType = (modelType: string): string => {
  switch (modelType) {
    case ModelType.ChatModel:
      return "/chat";
    case ModelType.VLM:
      return "/chat"; // VLM reuses the chat UI (supports image content)
    case ModelType.ImageGeneration:
      return "/image-generation";
    case ModelType.VideoGeneration:
      return "/chat"; // placeholder until video UI exists
    case ModelType.ObjectDetectionModel:
      return "/object-detection";
    case ModelType.SpeechRecognitionModel:
      return "/speech-to-text";
    case ModelType.ImageClassificationModel:
      return "/image-classification";
    case ModelType.FaceRecognitionModel:
      return "/face-recognition";
    case ModelType.TTS:
      return "/tts";
    case ModelType.Embedding:
      return "/chat"; // placeholder
    case ModelType.CNN:
      return "/object-detection"; // CNN reuses object detection UI
    default:
      return "/chat";
  }
};

// ----- deployModel with device_id support -----
export const deployModel = async (
  modelId: string,
  weightsId: string,
  deviceId: number = 0,
): Promise<{ job_id?: string; status?: string; message?: string }> => {
  const payload = JSON.stringify({
    model_id: modelId,
    weights_id: weightsId,
    device_id: deviceId,
  });
  const response = await fetch("/docker-api/deploy/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  return response.json();
};

// ----- TTS Inference -----
export const runTTSInference = async (
  deployId: string,
  text: string,
): Promise<Blob> => {
  const response = await fetch("/models-api/tts/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deploy_id: deployId, text }),
  });
  if (!response.ok) {
    throw new Error(`TTS request failed: HTTP ${response.status}`);
  }
  return response.blob();
};

// ----- Voice Pipeline -----
export interface VoicePipelineRequest {
  audioFile: File;
  whisperDeployId: string;
  llmDeployId: string;
  ttsDeployId?: string;
  systemPrompt?: string;
}

/**
 * Calls the voice pipeline endpoint and returns an SSE EventSource.
 * The caller is responsible for closing the EventSource when done.
 */
export const runVoicePipeline = async (
  req: VoicePipelineRequest,
  onTranscript: (text: string) => void,
  onLlmChunk: (text: string) => void,
  onAudio: (dataUrl: string) => void,
  onError: (stage: string, message: string) => void,
  onDone: () => void,
  onMetrics?: (metrics: Record<string, number>) => void,
): Promise<void> => {
  const form = new FormData();
  form.append("audio_file", req.audioFile);
  form.append("whisper_deploy_id", req.whisperDeployId);
  form.append("llm_deploy_id", req.llmDeployId);
  if (req.ttsDeployId) form.append("tts_deploy_id", req.ttsDeployId);
  if (req.systemPrompt) form.append("system_prompt", req.systemPrompt);

  const response = await fetch("/models-api/pipeline/voice/", {
    method: "POST",
    body: form,
  });

  if (!response.ok || !response.body) {
    onError("pipeline", `HTTP ${response.status}`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === "transcript") onTranscript(evt.text);
        else if (evt.type === "llm_chunk") onLlmChunk(evt.text);
        else if (evt.type === "audio_url") onAudio(evt.url);
        else if (evt.type === "metrics" && onMetrics) {
          const { type: _, ...metricsData } = evt;
          onMetrics(metricsData);
        }
        else if (evt.type === "error") onError(evt.stage ?? "unknown", evt.message);
        else if (evt.type === "done") onDone();
      } catch {
        // skip malformed lines
      }
    }
  }
};

/**
 * Infer model type from name (and optionally image) when model_type is not available (e.g. Docker-only data).
 * Recognizes speech models via "whisper", "speech", "asr", or "speech_recognition" in name or image.
 */
export const getModelTypeFromName = (
  modelName: string,
  image?: string
): string => {
  const name = (modelName ?? "").toLowerCase();
  const imageStr = (image ?? "").toLowerCase();
  const combined = `${name} ${imageStr}`;

  if (combined.includes("yolo")) {
    return ModelType.ObjectDetectionModel;
  }
  if (combined.includes("face") && combined.includes("recognition")) {
    return ModelType.FaceRecognitionModel;
  }
  if (combined.includes("diffusion")) {
    return ModelType.ImageGeneration;
  }
  if (
    combined.includes("whisper") ||
    combined.includes("speech") ||
    combined.includes("asr") ||
    combined.includes("speech_recognition")
  ) {
    return ModelType.SpeechRecognitionModel;
  }
  if (combined.includes("tts")) {
    return ModelType.TTS;
  }
  if (combined.includes("forge")) {
    return ModelType.ImageClassificationModel;
  }
  return ModelType.ChatModel;
};

export const checkDeployedModels = async (): Promise<boolean> => {
  try {
    const fetchedModels = await fetchModels();
    console.log("Fetched models:", fetchedModels);
    return fetchedModels !== null && fetchedModels.length > 0;
  } catch (error) {
    console.log("Error fetching models:", error);
    console.error("Error checking deployed models:", error);
    return false;
  }
};

/**
 * Fetch deployed models from the models-api endpoint
 * This provides more detailed information about deployed models than the docker status endpoint
 */
export const fetchDeployedModelsInfo = async (): Promise<
  DeployedModelInfo[]
> => {
  try {
    const response = await fetch(deployedModelsURL);
    if (!response.ok) {
      if (response.status === 404) {
        // No deployed models or endpoint not available
        return [];
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Transform the deployed models data into our format
    const modelsArray: DeployedModelInfo[] = Object.entries(data).map(
      ([id, modelData]: [string, any]) => ({
        id,
        modelName:
          modelData.model_impl?.model_name ||
          modelData.model_impl?.hf_model_id ||
          "Unknown Model",
        status: "deployed",
        model_type: modelData.model_impl?.model_type,
        internal_url: modelData.internal_url,
        health_url: modelData.health_url,
        max_model_len: modelData.max_model_len ?? null,
        model_impl: modelData.model_impl,
      })
    );

    return modelsArray;
  } catch (error) {
    console.error("Failed to fetch deployed models info:", error);
    return [];
  }
};

/**
 * Check if any models are currently deployed and return their count and names
 */
export const checkCurrentlyDeployedModels = async (): Promise<{
  hasDeployedModels: boolean;
  count: number;
  modelNames: string[];
}> => {
  try {
    const deployedModels = await fetchDeployedModelsInfo();
    return {
      hasDeployedModels: deployedModels.length > 0,
      count: deployedModels.length,
      modelNames: deployedModels.map((model) => model.modelName),
    };
  } catch (error) {
    console.error("Error checking currently deployed models:", error);
    return {
      hasDeployedModels: false,
      count: 0,
      modelNames: [],
    };
  }
};

// ----- Discover & Register External Containers -----

export interface DiscoveredContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  port_bindings: Record<string, { HostIp: string; HostPort: string }[] | null>;
}

export const discoverContainers = async (): Promise<DiscoveredContainer[]> => {
  const response = await axios.get<DiscoveredContainer[]>(
    "/docker-api/discover-containers/"
  );
  return response.data;
};

export interface RegisterExternalModelRequest {
  container_id: string;
  model_type: string;
  model_name: string;
  hf_model_id?: string;
  service_port?: number;
  service_route?: string;
  health_route?: string;
  device_id: number;
  chips_required?: number;
}

export interface RegisterExternalModelResponse {
  status: string;
  container_id: string;
  container_name: string;
  corrections?: string[];
  message?: string;
}

export const registerExternalModel = async (
  req: RegisterExternalModelRequest
): Promise<RegisterExternalModelResponse> => {
  const response = await axios.post<RegisterExternalModelResponse>(
    "/docker-api/register-external/",
    req
  );
  return response.data;
};

export interface CatalogModel {
  model_name: string;
  model_type: string;
  hf_model_id: string;
  service_route: string;
  health_route: string;
  display_model_type?: string;
}

export const fetchModelCatalog = async (): Promise<CatalogModel[]> => {
  const response = await axios.get("/docker-api/catalog/");
  // Catalog endpoint returns { status, models: { [id]: {...} } }
  const models = response.data?.models;
  if (models && typeof models === "object" && !Array.isArray(models)) {
    return Object.values(models) as CatalogModel[];
  }
  return [];
};

// Utility to extract short model name from container name
export function extractShortModelName(containerName: string): string {
  // Example: 'tt-metal-yolov4-src-base_p8001' => 'yolov4'
  // This regex looks for 'yolov4' or similar model names between dashes
  const match = containerName.match(/(?:^|-)yolov\d{0,2}(?:-|$)/i);
  if (match) {
    return match[0].replace(/^-|-?$/g, "");
  }
  // Fallback: try to extract the part after 'tt-metal-' and before '-src' or '_p'
  const fallback = containerName.match(/tt-metal-([^-_]+)/i);
  if (fallback && fallback[1]) {
    return fallback[1];
  }
  // If all else fails, return the original name
  return containerName;
}
