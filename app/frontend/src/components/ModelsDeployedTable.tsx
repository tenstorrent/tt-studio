import { useState, useEffect } from "react";
import axios from "axios";
import { Card } from "./ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Button } from "./ui/button";
import { useTheme } from "../providers/ThemeProvider";
import CustomToaster, { customToast } from "./CustomToaster";
import { Spinner } from "./ui/spinner";
import { useNavigate } from "react-router-dom";
import CopyableText from "./CopyableText";
import StatusBadge from "./StatusBadge";
import HealthBadge from "./HealthBadge";

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

const initialModelsDeployed: Model[] = [];

export function ModelsDeployedTable() {
  const navigate = useNavigate();
  const [modelsDeployed, setModelsDeployed] = useState<Model[]>(
    initialModelsDeployed
  );
  const [fadingModels, setFadingModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState<string[]>([]);
  const { theme } = useTheme();

  const fetchModels = async () => {
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

      // Manually add a model with a "bad" status
      models.push({
        id: "badModel",
        image: "bad/image:latest",
        status: "stopped",
        health: "unhealthy",
        ports: "127.0.0.1:8080->80/tcp",
        name: "Bad Model",
      });

      setModelsDeployed(models);
    } catch (error) {
      console.error("Error fetching models:", error);
      customToast.error("Failed to fetch models.");
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleDelete = async (modelId: string) => {
    console.log(`Delete button clicked for model ID: ${modelId}`);
    const truncatedModelId = modelId.substring(0, 4);

    const deleteModel = async () => {
      setLoadingModels((prev) => [...prev, modelId]);
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

        setFadingModels((prev) => [...prev, modelId]);
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
      } finally {
        setLoadingModels((prev) => prev.filter((id) => id !== modelId));
      }
    };

    customToast.promise(deleteModel(), {
      loading: `Attempting to delete Model ID: ${truncatedModelId}...`,
      success: `Model ID: ${truncatedModelId} has been deleted.`,
      error: `Failed to delete Model ID: ${truncatedModelId}.`,
    });
  };

  const handleRedeploy = (modelName: string) => {
    console.log(`Redeploy button clicked for model: ${modelName}`);
    customToast.success(`Model ${modelName} has been redeployed.`);
  };

  const handleChatUI = (modelID: string) => {
    console.log(`ChatUI button clicked for model: ${modelID}`);
    console.log("Opening Chat UI for model");
    customToast.success(`Chat UI for model ${modelID} opened.`);

    navigate("/chat-ui", { state: { containerID: modelID } });

    console.log("Navigated to chat-ui page");
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setModelsDeployed((prevModels) =>
        prevModels.filter((model) => !fadingModels.includes(model.id))
      );
    }, 3000);
    return () => clearTimeout(timer);
  }, [fadingModels]);

  return (
    <Card
      className={`bg-${theme === "dark" ? "zinc-900" : "white"} text-${
        theme === "dark" ? "zinc-200" : "black"
      }`}
    >
      <CustomToaster />
      <Table className={`text-${theme === "dark" ? "zinc-200" : "black"}`}>
        <TableCaption
          className={`text-${theme === "dark" ? "zinc-400" : "gray-500"}`}
        >
          Models Deployed
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead className="text-left">Container ID</TableHead>
            <TableHead className="text-left">Image</TableHead>
            <TableHead className="text-left">Status</TableHead>
            <TableHead className="text-left">Health</TableHead>
            <TableHead className="text-left">Ports</TableHead>
            <TableHead className="text-left">Names</TableHead>
            <TableHead className="text-left">Manage</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {modelsDeployed.map((model) => (
            <TableRow
              key={model.id}
              className={`transition-colors duration-1000 ${
                fadingModels.includes(model.id)
                  ? theme === "dark"
                    ? "bg-zinc-700 opacity-50"
                    : "bg-zinc-200 opacity-50"
                  : ""
              }`}
            >
              <TableCell className="text-left">
                <CopyableText text={model.id} />
              </TableCell>
              <TableCell className="text-left">{model.image}</TableCell>
              <TableCell className="text-left">
                <StatusBadge status={model.status} />
              </TableCell>
              <TableCell className="text-left">
                <HealthBadge health={model.health} />
              </TableCell>
              <TableCell className="text-left">
                <CopyableText text={model.ports} />
              </TableCell>
              <TableCell className="text-left">
                <CopyableText text={model.name} />
              </TableCell>
              <TableCell className="text-left">
                <div className="flex gap-2">
                  {fadingModels.includes(model.id) ? (
                    <Button
                      onClick={() => handleRedeploy(model.image)}
                      className={`${
                        theme === "dark"
                          ? "bg-zinc-700 hover:bg-zinc-600 text-white"
                          : "bg-gray-300 hover:bg-gray-400 text-black"
                      }`}
                    >
                      Redeploy
                    </Button>
                  ) : (
                    <>
                      {loadingModels.includes(model.id) ? (
                        <Button
                          disabled
                          className={`${
                            theme === "dark"
                              ? "bg-red-700 hover:bg-red-600 text-white"
                              : "bg-red-500 hover:bg-red-400 text-white"
                          }`}
                        >
                          <Spinner />
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handleDelete(model.id)}
                          className={`${
                            theme === "dark"
                              ? "bg-red-700 hover:bg-red-600 text-white"
                              : "bg-red-500 hover:bg-red-400 text-white"
                          }`}
                        >
                          Delete
                        </Button>
                      )}
                      <Button
                        onClick={() => handleChatUI(model.id)}
                        className={`${
                          theme === "dark"
                            ? "bg-blue-500 hover:bg-blue-400 text-white"
                            : "bg-blue-500 hover:bg-blue-400 text-white"
                        }`}
                      >
                        ChatUI
                      </Button>
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
