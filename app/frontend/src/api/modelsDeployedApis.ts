//  Summary: API functions for fetching and deleting models deployed on the models deployed component.
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
}
interface Model {
  id: string;
  image: string;
  status: string;
  health: string;
  ports: string;
  name: string;
}

export const fetchModels = async (): Promise<Model[]> => {
  try {
    const response = await axios.get<{ [key: string]: ContainerData }>(
      statusURl
    );
    const data = response.data;
    console.log("Data fetched for tables:", data);

    const models: Model[] = Object.keys(data).map((key) => {
      const container = data[key];
      const portMapping = Object.keys(container.port_bindings)
        .map(
          (port) =>
            `${container.port_bindings[port][0].HostIp}:${container.port_bindings[port][0].HostPort}->${port}`
        )
        .join(", ");

      return {
        id: key,
        image: container.image_name,
        status: container.status,
        health: container.health,
        ports: portMapping,
        name: container.name,
      };
    });

    return models;
  } catch (error) {
    console.error("Error fetching models:", error);
    customToast.error("Failed to fetch models.");
    throw error;
  }
};

export const deleteModel = async (modelId: string): Promise<void> => {
  const truncatedModelId = modelId.substring(0, 4);
  try {
    const payload = JSON.stringify({ container_id: modelId });
    console.log("Payload:", payload);

    const response = await axios.post(stopModelsURL, payload, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    console.log("Response:", response);

    if (response.data.status !== "success") {
      customToast.error("Failed to stop the container");
      throw new Error("Failed to stop the container");
    }
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
      customToast.error(
        `Failed to delete Model ID: ${truncatedModelId} - ${error.message}`
      );
    } else {
      console.error("Unknown error stopping the container", error);
      customToast.error(
        `Failed to delete Model ID: ${truncatedModelId} - Unknown error`
      );
    }
    throw error;
  }
};

export const handleRedeploy = (modelName: string): void => {
  console.log(`Redeploy button clicked for model: ${modelName}`);
  customToast.success(`Model ${modelName} has been redeployed.`);
};

export const handleChatUI = (
  modelID: string,
  modelName: string,
  navigate: NavigateFunction
): void => {
  console.log(`ChatUI button clicked for model: ${modelID}`);
  console.log(`Opening Chat UI for model: ${modelName}`);
  customToast.success(`Chat UI for model ${modelID} (${modelName}) opened.`);

  navigate("/chat-ui", {
    state: { containerID: modelID, modelName: modelName },
  });

  console.log("Navigated to chat-ui page");
};
