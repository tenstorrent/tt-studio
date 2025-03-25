// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import axios from "axios";
import { customToast } from "../components/CustomToaster";
import { NavigateFunction } from "react-router-dom";

const dockerAPIURL = "/docker-api/";
const statusURl = `${dockerAPIURL}status/`;
const stopModelsURL = `${dockerAPIURL}stop/`;

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
  model_type: string;
}

interface Model {
  id: string;
  image: string;
  status: string;
  health: string;
  ports: string;
  name: string;
  model_type: string;
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

export const ModelType = {
  ChatModel: "ChatModel",
  ImageGeneration: "ImageGeneration",
  ObjectDetection: "ObjectDetection",
  SpeechRecognition: "SpeechRecognition",
};

export const fetchModels = async (): Promise<Model[]> => {
  try {
    const response = await axios.get<{ [key: string]: ContainerData }>(
      statusURl,
    );
    const data = response.data;

    const models: Model[] = Object.keys(data).map((key) => {
      const container = data[key];
      const portMapping = Object.keys(container.port_bindings)
        .map(
          (port) =>
            `${container.port_bindings[port][0].HostIp}:${container.port_bindings[port][0].HostPort}->${port}`,
        )
        .join(", ");

      // map container's model_type to frontend ModelType enum
      var model_type;
      switch (container.model_type) {
        case "CHAT":
          model_type = ModelType.ChatModel;
          break;
        case "IMAGE_GENERATION":
          model_type = ModelType.ImageGeneration;
          break;
        case "OBJECT_DETECTION":
          model_type = ModelType.ObjectDetection;
          break;
        case "SPEECH_RECOGNITION":
          model_type = ModelType.SpeechRecognition;
          break;
        default:
          throw new Error("No valid ModelType enumeration.");
      }

      return {
        id: key,
        image: container.image_name,
        status: container.status,
        health: container.health,
        ports: portMapping,
        name: container.name,
        model_type: model_type,
      };
    });

    return models;
  } catch (error) {
    console.error("Error fetching models:", error);
    customToast.error("Failed to fetch models.");
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
      customToast.success(
        `Model ID: ${truncatedModelId} has been deleted successfully.`,
      );

      if (
        response.data.reset_response &&
        response.data.reset_response.status === "success"
      ) {
        customToast.success(
          `Model ID: ${truncatedModelId} has been reset successfully.`,
        );
      } else {
        customToast.error(`Board Reset failed.`);
      }

      console.log(
        `Reset Output: ${response.data.reset_response?.output || "No reset output available"
        }`,
      );
    }

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Error stopping the container:", error.response?.data);
      customToast.error(
        `Failed to delete Model ID: ${truncatedModelId} - ${error.response?.data.message || error.message
        }`,
      );
    } else if (error instanceof Error) {
      console.error("Error stopping the container:", error.message);
      customToast.error(
        `Failed to delete Model ID: ${truncatedModelId} - ${error.message}`,
      );
    } else {
      console.error("Unknown error stopping the container", error);
      customToast.error(
        `Failed to delete Model ID: ${truncatedModelId} - Unknown error`,
      );
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
  modelType: string,
  navigate: NavigateFunction,
): void => {
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
      return "/chat-ui";
    case ModelType.ImageGeneration:
      return "/image-generation";
    case ModelType.ObjectDetection:
      return "/object-detection";
    default:
      return "/chat-ui"; // /chat-ui is the default
  }
};

export const getModelTypeFromName = (modelName: string): string => {
  // TODO: remove this hack once we enumerate the types of models #<ISSUE_NUMBER>
  // this should eventually become a switch-case statement
  var modelType: string;
  if (modelName.includes("yolo")) {
    modelType = ModelType.ObjectDetectionModel;
  } else if (modelName.includes("diffusion")) {
    modelType = ModelType.ImageGeneration;
  } else {
    modelType = ModelType.ChatModel;
  }
  return modelType;
};
