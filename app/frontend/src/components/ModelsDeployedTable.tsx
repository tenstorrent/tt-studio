import { useState, useEffect } from "react";
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
import {
  fetchModels,
  deleteModel,
  handleRedeploy,
  handleChatUI,
} from "../api/modelsDeployedApis";

import { ScrollArea, ScrollBar } from "./ui/scroll-area";

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

  useEffect(() => {
    const loadModels = async () => {
      try {
        const models = await fetchModels();
        setModelsDeployed(models);
      } catch (error) {
        console.error("Error fetching models:", error);
        customToast.error("Failed to fetch models.");
      }
    };

    loadModels();
  }, []);

  const handleDelete = async (modelId: string) => {
    console.log(`Delete button clicked for model ID: ${modelId}`);
    const truncatedModelId = modelId.substring(0, 4);

    const deleteModelAsync = async () => {
      setLoadingModels((prev) => [...prev, modelId]);
      try {
        await deleteModel(modelId);
        setFadingModels((prev) => [...prev, modelId]);
      } catch (error) {
        console.error("Error stopping the container:", error);
      } finally {
        setLoadingModels((prev) => prev.filter((id) => id !== modelId));
      }
    };

    customToast.promise(deleteModelAsync(), {
      loading: `Attempting to delete Model ID: ${truncatedModelId}...`,
      success: `Model ID: ${truncatedModelId} has been deleted.`,
      error: `Failed to delete Model ID: ${truncatedModelId}.`,
    });
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
    <Card>
      <ScrollArea className="whitespace-nowrap rounded-md border">
        <CustomToaster />
        <Table>
          <TableCaption className="text-TT-black dark:text-TT-white text-xl">
            Models Deployed
          </TableCaption>
          <TableHeader>
            <TableRow
              className={`${
                theme === "dark"
                  ? "bg-zinc-900 rounded-lg"
                  : "bg-zinc-200 rounded-lg"
              }`}
            >
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
                } rounded-lg`}
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
                          theme === "light"
                            ? "bg-zinc-700 hover:bg-zinc-600 text-white"
                            : "bg-gray-300 hover:bg-gray-400 text-black"
                        } rounded-lg`}
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
                            } rounded-lg`}
                          >
                            <Spinner />
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleDelete(model.id)}
                            className="bg-red-700 dark:bg-red-600 hover:bg-red-500 dark:hover:bg-red-500 text-white rounded-lg"
                          >
                            Delete
                          </Button>
                        )}
                        <Button
                          onClick={() =>
                            handleChatUI(model.id, model.name, navigate)
                          }
                          className="bg-blue-500 dark:bg-blue-700 hover:bg-blue-600 dark:hover:bg-blue-600 text-white rounded-lg"
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
        <ScrollBar
          className="scrollbar-thumb-rounded "
          orientation="horizontal"
        />
      </ScrollArea>
    </Card>
  );
}
