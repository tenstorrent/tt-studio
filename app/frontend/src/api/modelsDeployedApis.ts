// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
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
  internal_url?: string;
  health_url?: string;
  model_impl?: {
    model_name?: string;
    hf_model_id?: string;
  };
}

export const ModelType = {
  ChatModel: "ChatModel",
  ImageGeneration: "ImageGeneration",
  ObjectDetectionModel: "ObjectDetectionModel",
  SpeechRecognitionModel: "SpeechRecognitionModel",
};

export const fetchModels = async (): Promise<Model[]> => {
  try {
    console.log(`Fetching models from ${statusURl}`);
    const response = await axios.get<{ [key: string]: ContainerData }>(statusURl, {
      timeout: 10000, // 10 second timeout
      headers: { "Cache-Control": "no-cache" },
    });

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
      if (container.port_bindings && Object.keys(container.port_bindings).length > 0) {
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
        customToast.error(`Server error: ${error.response.status} ${error.response.statusText}`);
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
  const truncatedModelId = modelId.substring(0, 4);
  try {
    const payload = JSON.stringify({ container_id: modelId });
    console.log("Payload:", payload);

    const response = await axios.post<StopResponse>(stopModelsURL, payload, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    console.log("Response: on ts from backend", response);

    if (
      response.data.status !== "success" ||
      !response.data.stop_response ||
      response.data.stop_response.status !== "success"
    ) {
      customToast.error("Failed to stop the container");
      throw new Error("Failed to stop the container");
    } else {
      customToast.success(`Model ID: ${truncatedModelId} has been deleted successfully.`);

      if (response.data.reset_response && response.data.reset_response.status === "success") {
        customToast.success(`Model ID: ${truncatedModelId} has been reset successfully.`);
      } else {
        customToast.error(`Board Reset failed.`);
      }

      console.log(
        `Reset Output: ${response.data.reset_response?.output || "No reset output available"}`
      );
    }

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Error stopping the container:", error.response?.data);
      customToast.error(
        `Failed to delete Model ID: ${truncatedModelId} - ${
          error.response?.data.message || error.message
        }`
      );
    } else if (error instanceof Error) {
      console.error("Error stopping the container:", error.message);
      customToast.error(`Failed to delete Model ID: ${truncatedModelId} - ${error.message}`);
    } else {
      console.error("Unknown error stopping the container", error);
      customToast.error(`Failed to delete Model ID: ${truncatedModelId} - Unknown error`);
    }
    throw error;
  }
};

export const handleRedeploy = (modelName: string): void => {
  customToast.success(`Model ${modelName} has been redeployed.`);
};

export const handleModelNavigationClick = (
  modelID: string,
  modelName: string,
  navigate: NavigateFunction
): void => {
  const modelType = getModelTypeFromName(modelName);
  const destination = getDestinationFromModelType(modelType);
  console.log(`${modelType} button clicked for model: ${modelID}`);
  console.log(`Opening ${modelType} for model: ${modelName}`);
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
    case ModelType.ImageGeneration:
      return "/image-generation";
    case ModelType.ObjectDetectionModel:
      return "/object-detection";
    case ModelType.SpeechRecognitionModel:
      return "/speech-to-text";
    default:
      return "/chat"; // /chat is the default
  }
};

export const getModelTypeFromName = (modelName: string): string => {
  var modelType: string;
  if (modelName.toLowerCase().includes("yolo")) {
    modelType = ModelType.ObjectDetectionModel;
  } else if (modelName.toLowerCase().includes("diffusion")) {
    modelType = ModelType.ImageGeneration;
  } else if (modelName.toLowerCase().includes("whisper")) {
    modelType = ModelType.SpeechRecognitionModel;
  } else {
    modelType = ModelType.ChatModel;
  }
  return modelType;
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
export const fetchDeployedModelsInfo = async (): Promise<DeployedModelInfo[]> => {
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
          modelData.model_impl?.model_name || modelData.model_impl?.hf_model_id || "Unknown Model",
        status: "deployed",
        internal_url: modelData.internal_url,
        health_url: modelData.health_url,
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
