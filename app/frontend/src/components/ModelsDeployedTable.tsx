// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
import CopyableText from "./CopyableText";
import StatusBadge from "./StatusBadge";
import HealthBadge from "./HealthBadge";
import {
  fetchModels,
  getModelTypeFromName,
  deleteModel,
  handleRedeploy,
  ModelType,
  handleModelNavigationClick,
} from "../api/modelsDeployedApis";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";
import { NoModelsDialog } from "./NoModelsDeployed";
import { ModelsDeployedSkeleton } from "./ModelsDeployedSkeleton";
import { useRefresh } from "../providers/RefreshContext";
import { useModels } from "../providers/ModelsContext";
import {
  Box,
  Image,
  Activity,
  Heart,
  Network,
  Tag,
  Settings,
  Trash2,
  MessageSquare,
  AlertCircle,
  Eye,
  AudioLines,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

export default function ModelsDeployedTable() {
  const navigate = useNavigate();
  const { refreshTrigger, triggerRefresh } = useRefresh();
  const { models, setModels } = useModels();
  const [fadingModels, setFadingModels] = useState<string[]>([]);
  const [pulsatingModels, setPulsatingModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const { theme } = useTheme();

  const loadModels = useCallback(async () => {
    try {
      const fetchedModels = await fetchModels();
      setModels(fetchedModels);
      if (fetchedModels.length === 0) {
        triggerRefresh();
      }
    } catch (error) {
      console.error("Error fetching models:", error);
      customToast.error("Failed to fetch models.");
    } finally {
      setLoading(false);
    }
  }, [setModels, triggerRefresh]);

  useEffect(() => {
    loadModels();
  }, [loadModels, refreshTrigger]);

  const handleDelete = async (modelId: string) => {
    console.log(`Delete button clicked for model ID: ${modelId}`);
    const truncatedModelId = modelId.substring(0, 4);

    setPulsatingModels((prev) => [...prev, modelId]);

    const deleteModelAsync = async () => {
      setLoadingModels((prev) => [...prev, modelId]);
      try {
        const response = await deleteModel(modelId);
        const resetOutput =
          response.reset_response?.output || "No reset output available";
        console.log(`Reset Output in tsx: ${resetOutput}`);

        setFadingModels((prev) => [...prev, modelId]);

        const remainingModels = models.filter((model) => model.id !== modelId);
        if (remainingModels.length === 0) {
          triggerRefresh();
        }
      } catch (error) {
        console.error("Error stopping the container:", error);
      } finally {
        setLoadingModels((prev) => prev.filter((id) => id !== modelId));
        setPulsatingModels((prev) => prev.filter((id) => id !== modelId));
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
      setModels((prevModels) =>
        prevModels.filter((model) => !fadingModels.includes(model.id))
      );
      setFadingModels([]);
    }, 3000);
    return () => clearTimeout(timer);
  }, [fadingModels, setModels]);

  if (loading) {
    return <ModelsDeployedSkeleton />;
  }

  if (models.length === 0) {
    return <NoModelsDialog messageKey="reset" />;
  }

  const isLLaMAModel = (modelName: string) => {
    return modelName.toLowerCase().includes("llama");
  };

  const getModelIcon = (modelName: string) => {
    const modelType = getModelTypeFromName(modelName);
    switch (modelType) {
      case ModelType.ChatModel:
        return <MessageSquare className="w-4 h-4 mr-2" />;
      case ModelType.ImageGeneration:
        return <Image className="w-4 h-4 mr-2" />;
      case ModelType.ObjectDetectionModel:
        return <Eye className="w-4 h-4 mr-2" />;
      case ModelType.SpeechRecognitionModel:
        return <AudioLines className="w-4 h-4 mr-2" />;
      default:
        return <MessageSquare className="w-4 h-4 mr-2" />;
    }
  };

  const getModelTypeLabel = (modelName: string) => {
    const modelType = getModelTypeFromName(modelName);
    switch (modelType) {
      case ModelType.ChatModel:
        return "Chat";
      case ModelType.ImageGeneration:
        return "Image Generation";
      case ModelType.ObjectDetectionModel:
        return "Object Detection";
      case ModelType.SpeechRecognitionModel:
        return "Speech Recognition";
      default:
        return "Chat";
    }
  };

  const getTooltipText = (type: string) => {
    switch (type) {
      case "chat":
        return "Open Chat for this model";
      case "chat-ui":
        return "Open Chat for this model";
      case "image-generation":
        return "Open Image Generation for this model";
      default:
        return `Open ${type} for this model`;
    }
  };

  return (
    <Card className="border-0 shadow-none">
      <ScrollArea className="whitespace-nowrap rounded-md">
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
              <TableHead className="text-left">
                <Box className="inline-block mr-2" size={16} /> Container ID
              </TableHead>
              <TableHead className="text-left">
                <Image className="inline-block mr-2" size={16} /> Image
              </TableHead>
              <TableHead className="text-left">
                <Activity className="inline-block mr-2" size={16} /> Status
              </TableHead>
              <TableHead className="text-left">
                <Heart className="inline-block mr-2" size={16} /> Health
              </TableHead>
              <TableHead className="text-left">
                <Network className="inline-block mr-2" size={16} /> Ports
              </TableHead>
              <TableHead className="text-left">
                <Tag className="inline-block mr-2" size={16} /> Names
              </TableHead>
              <TableHead className="text-left">
                <Settings className="inline-block mr-2" size={16} /> Manage
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model) => (
              <TableRow
                key={model.id}
                className={`transition-all duration-1000 ${
                  fadingModels.includes(model.id)
                    ? theme === "dark"
                      ? "bg-zinc-900 opacity-50"
                      : "bg-zinc-200 opacity-50"
                    : ""
                } ${
                  pulsatingModels.includes(model.id) ? "animate-pulse" : ""
                } rounded-lg`}
              >
                <TableCell className="text-left">
                  <CopyableText text={model.id} />
                </TableCell>
                <TableCell className="text-left">
                  {model.image || "N/A"}
                </TableCell>
                <TableCell className="text-left">
                  {model.status ? <StatusBadge status={model.status} /> : "N/A"}
                </TableCell>
                <TableCell className="text-left">
                  {model.health ? <HealthBadge deployId={model.id} /> : "N/A"}
                </TableCell>
                <TableCell className="text-left">
                  {model.ports ? <CopyableText text={model.ports} /> : "N/A"}
                </TableCell>
                <TableCell className="text-left">
                  {model.name ? <CopyableText text={model.name} /> : "N/A"}
                </TableCell>
                <TableCell className="text-left">
                  <div className="flex gap-2">
                    {fadingModels.includes(model.id) ? (
                      <Button
                        onClick={() =>
                          model.image && handleRedeploy(model.image)
                        }
                        className={`${
                          theme === "light"
                            ? "bg-zinc-700 hover:bg-zinc-600 text-white"
                            : "bg-zinc-600 hover:bg-zinc-500 text-white"
                        } rounded-lg`}
                        disabled={!model.image}
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
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </Button>
                        )}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                onClick={() =>
                                  model.name &&
                                  handleModelNavigationClick(
                                    model.id,
                                    model.name,
                                    navigate
                                  )
                                }
                                className={`${
                                  theme === "dark"
                                    ? "bg-blue-500 dark:bg-blue-700 hover:bg-blue-400 dark:hover:bg-blue-600 text-white"
                                    : "bg-blue-500 hover:bg-blue-400 text-white"
                                } rounded-lg`}
                                disabled={!model.name}
                              >
                                {getModelIcon(model.name)}
                                {getModelTypeLabel(model.name)}
                                {isLLaMAModel(model.name || "") && (
                                  <AlertCircle className="w-4 h-4 ml-2 text-yellow-600" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="bg-gray-700 text-white">
                              {isLLaMAModel(model.name || "") ? (
                                <p>
                                  Warning: First-time inference may take up to
                                  an hour. Subsequent runs may take 5-7 minutes.
                                </p>
                              ) : (
                                <p>
                                  {getTooltipText(
                                    getModelTypeLabel(model.name)
                                  )}
                                </p>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ScrollBar
          className="scrollbar-thumb-rounded"
          orientation="horizontal"
        />
      </ScrollArea>
    </Card>
  );
}
