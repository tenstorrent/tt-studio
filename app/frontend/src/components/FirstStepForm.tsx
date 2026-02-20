// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import axios from "axios";
import { useEffect, useState } from "react";
import {
  Bot,
  XCircle,
  CheckCircle2,
  Zap,
  FlaskConical,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { useStepper } from "./ui/stepper";
import { customToast } from "./CustomToaster";
import { StepperFormActions } from "./StepperFormActions";
import { Model, getModelsUrl } from "./SelectionSteps";
import BoardBadge from "./BoardBadge";
import { DeployedModelsWarning } from "./DeployedModelsWarning";
import { useModels } from "../hooks/useModels";

// Status configuration with icons and labels
const STATUS_CONFIG = {
  COMPLETE: {
    label: "Complete",
    icon: CheckCircle2,
    color: "text-green-600",
    bgColor: "bg-green-50 dark:bg-green-900/20",
    borderColor: "border-green-200 dark:border-green-800",
  },
  FUNCTIONAL: {
    label: "Functional",
    icon: Zap,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    borderColor: "border-blue-200 dark:border-blue-800",
  },
  EXPERIMENTAL: {
    label: "Experimental",
    icon: FlaskConical,
    color: "text-amber-500",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
    borderColor: "border-amber-200 dark:border-amber-800",
  },
};

const FirstFormSchema = z.object({
  model: z.string().nonempty("Please select a model."),
});

export function FirstStepForm({
  setSelectedModel,
  setFormError,
  autoDeployModel,
  isAutoDeploying,
}: {
  setSelectedModel: (model: string) => void;
  setFormError: (hasError: boolean) => void;
  autoDeployModel?: string | null;
  isAutoDeploying?: boolean;
}) {
  const { nextStep } = useStepper();
  const {
    models: deployedModels,
    hasDeployedModels,
    refreshModels,
  } = useModels();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWarningDismissed, setIsWarningDismissed] = useState(false);

  // Refresh models context when component mounts
  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  // Show immediate toast notification if models are deployed
  useEffect(() => {
    if (hasDeployedModels && deployedModels.length > 0) {
      customToast.warning(
        `${deployedModels.length} model${deployedModels.length > 1 ? "s are" : " is"} currently deployed. Consider deleting existing models before deploying new ones.`,
        "deployed-models-warning"
      );
    }
  }, [hasDeployedModels, deployedModels]);

  // Fetch models with compatibility information
  useEffect(() => {
    const fetchModels = async () => {
      try {
        setIsLoading(true);
        const response = await axios.get<Model[]>(getModelsUrl);
        console.log("fetched models:", response.data);
        setModels(response.data);
      } catch (error) {
        console.error("Error fetching models:", error);
        customToast.error("Failed to load models");
      } finally {
        setIsLoading(false);
      }
    };

    fetchModels();
  }, []);

  const form = useForm<z.infer<typeof FirstFormSchema>>({
    resolver: zodResolver(FirstFormSchema),
    defaultValues: {
      model: "",
    },
  });

  useEffect(() => {
    setFormError(!!form.formState.errors.model);
  }, [form.formState.errors]);

  const onSubmit = async (data: z.infer<typeof FirstFormSchema>) => {
    setIsSubmitting(true);
    try {
      const selectedModel = models.find((model) => model.name === data.model);
      if (selectedModel) {
        if (selectedModel.is_compatible === false) {
          customToast.error(
            `This model is not compatible with your ${selectedModel.current_board} board`
          );
          setFormError(true);
          return;
        }
        if (selectedModel.is_compatible === null) {
          customToast.warning(
            `Board detection failed - this model's compatibility is unknown. It may not work properly.`
          );
        }

        // Extra warning if models are deployed
        if (hasDeployedModels && deployedModels.length > 0) {
          customToast.warning(
            `Warning: ${deployedModels.length} model${deployedModels.length > 1 ? "s are" : " is"} already deployed. You'll need to delete ${deployedModels.length > 1 ? "them" : "it"} before deploying this model.`
          );
        }

        console.log(
          "📝 FirstStepForm: Setting selectedModel to:",
          selectedModel.id
        );
        setSelectedModel(selectedModel.id);
        console.log(
          "📝 FirstStepForm: selectedModel set, waiting for status check..."
        );
        customToast.success("Model Selected!: " + selectedModel.name);
        setFormError(false);

        // Give a small delay to allow status check to start before navigating
        // The StepAdjuster will handle navigation if Docker step is removed
        setTimeout(() => {
          nextStep();
        }, 100);
      } else {
        customToast.error("Model not found!");
        setFormError(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auto-select model when in auto-deploy mode
  useEffect(() => {
    if (autoDeployModel && models.length > 0 && isAutoDeploying) {
      const targetModel = models.find(
        (model) =>
          model.name.toLowerCase().includes(autoDeployModel.toLowerCase()) ||
          model.name === autoDeployModel
      );

      if (targetModel) {
        console.log("Auto-selecting model:", targetModel.name);
        form.setValue("model", targetModel.name);

        // Auto-submit the form after a short delay
        setTimeout(() => {
          form.handleSubmit(onSubmit)();
        }, 1000);
      } else {
        customToast.error(`Auto-deploy model "${autoDeployModel}" not found`);
        console.error(
          "Available models:",
          models.map((m) => m.name)
        );
      }
    }
  }, [autoDeployModel, models, isAutoDeploying, form, onSubmit]);

  // Get current board info and group models by status and compatibility
  const currentBoard = models[0]?.current_board || "unknown";

  // Status priority order for sorting
  const STATUS_ORDER: Record<string, number> = {
    COMPLETE: 3,
    FUNCTIONAL: 2,
    EXPERIMENTAL: 1,
  };

  // Group models by release status, then by hardware compatibility within each group
  const groupModelsByStatus = () => {
    const grouped: Record<
      string,
      {
        compatible: Model[];
        incompatible: Model[];
        unknown: Model[];
      }
    > = {};

    models.forEach((model) => {
      const modelStatus = model.status || "EXPERIMENTAL";

      if (!grouped[modelStatus]) {
        grouped[modelStatus] = { compatible: [], incompatible: [], unknown: [] };
      }

      if (model.is_compatible === true) {
        grouped[modelStatus].compatible.push(model);
      } else if (model.is_compatible === false) {
        grouped[modelStatus].incompatible.push(model);
      } else {
        grouped[modelStatus].unknown.push(model);
      }
    });

    return grouped;
  };

  const groupedModels = groupModelsByStatus();
  const allModelsUnknown =
    models.length > 0 && models.every((model) => model.is_compatible === null);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Always show deployed models warning prominently */}
        {!isWarningDismissed && (
          <DeployedModelsWarning
            className="mb-8 mt-8"
            onClose={() => setIsWarningDismissed(true)}
          />
        )}

        {/* Auto-deploy indicator */}
        {isAutoDeploying && autoDeployModel && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              <span className="text-blue-800 dark:text-blue-200 font-medium">
                🤖 Auto-deploying: {autoDeployModel}
              </span>
            </div>
          </div>
        )}

        <FormField
          control={form.control}
          name="model"
          render={({ field }) => (
            <FormItem className="w-full mb-4 p-8">
              <FormLabel className="text-lg font-semibold text-gray-800 dark:text-white">
                <div className="flex items-center gap-3 mb-4">
                  <span>Select Model</span>
                  {/* Show inline warning if models are deployed */}
                  {hasDeployedModels && deployedModels.length > 0 && (
                    <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200 text-xs px-2 py-1 rounded-md font-normal">
                      ⚠️ {deployedModels.length} model
                      {deployedModels.length > 1 ? "s" : ""} deployed
                    </span>
                  )}
                </div>
              </FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  setFormError(false);
                }}
                defaultValue={field.value}
                disabled={isLoading}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        isLoading ? "Loading models..." : "Select a model"
                      }
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {/* Warning message when board detection failed */}
                  {allModelsUnknown && (
                    <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 mb-2">
                      <XCircle className="w-3 h-3" />
                      <span>
                        Board detection failed - compatibility unknown
                      </span>
                    </div>
                  )}

                  {/* Render models grouped by release status */}
                  {Object.entries(groupedModels)
                    .sort(
                      ([a], [b]) =>
                        (STATUS_ORDER[b] ?? 0) - (STATUS_ORDER[a] ?? 0)
                    )
                    .map(([modelStatus, modelsByCompatibility], statusIndex) => {
                      const statusConfig =
                        STATUS_CONFIG[
                          modelStatus as keyof typeof STATUS_CONFIG
                        ];
                      const hasModels =
                        modelsByCompatibility.compatible.length +
                          modelsByCompatibility.incompatible.length +
                          modelsByCompatibility.unknown.length >
                        0;

                      if (!hasModels) return null;

                      const IconComponent = statusConfig?.icon || Bot;

                      return (
                        <div key={modelStatus}>
                          {/* Status Group Header */}
                          {statusIndex > 0 && (
                            <div className="h-px bg-gray-200 dark:bg-gray-700 my-2" />
                          )}
                          <div
                            className={`flex items-center gap-2 px-2 py-2 text-xs font-semibold ${statusConfig?.color || "text-gray-600"} ${statusConfig?.bgColor || "bg-gray-50 dark:bg-gray-900/20"}`}
                          >
                            <IconComponent className="w-4 h-4" />
                            <span>{statusConfig?.label || modelStatus}</span>
                          </div>

                          {/* Compatible Models */}
                          {modelsByCompatibility.compatible.map((model) => (
                            <SelectItem
                              key={model.id}
                              value={model.name}
                              className="pl-6 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden"
                            >
                              <div className="flex items-center w-full">
                                <span className="text-green-500 mr-2 text-xs">
                                  ●
                                </span>
                                <span className="flex-1">{model.name}</span>
                                <span className="text-xs text-green-600 ml-2">
                                  Compatible
                                </span>
                              </div>
                            </SelectItem>
                          ))}

                          {/* Incompatible Models */}
                          {modelsByCompatibility.incompatible.map((model) => (
                            <SelectItem
                              key={model.id}
                              value={model.name}
                              disabled={true}
                              className="pl-6 opacity-50 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden"
                            >
                              <div className="flex items-center w-full">
                                <span className="text-red-500 mr-2 text-xs">
                                  ●
                                </span>
                                <span className="text-gray-500 flex-1">
                                  {model.name}
                                </span>
                                <span className="text-xs text-red-500 ml-2">
                                  Incompatible
                                </span>
                              </div>
                            </SelectItem>
                          ))}

                          {/* Unknown Compatibility Models */}
                          {modelsByCompatibility.unknown.map((model) => (
                            <SelectItem
                              key={model.id}
                              value={model.name}
                              className="pl-6 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden"
                            >
                              <div className="flex items-center w-full">
                                <span className="text-yellow-500 mr-2 text-xs">
                                  ●
                                </span>
                                <span className="flex-1">{model.name}</span>
                                <span className="text-xs text-yellow-600 ml-2">
                                  Unknown
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </div>
                      );
                    }
                  )}

                  {/* If no models loaded yet */}
                  {models.length === 0 && !isLoading && (
                    <div className="px-2 py-4 text-center text-gray-500">
                      No models available
                    </div>
                  )}
                </SelectContent>
              </Select>

              {/* Summary info */}
              {models.length > 0 && !isLoading && (
                <div className="mt-4 p-4 rounded-lg border-2 border-stone-200 bg-white text-stone-950 shadow-sm dark:border-stone-800 dark:bg-stone-950 dark:text-stone-50 hover:border-stone-400 dark:hover:border-stone-700 hover:shadow-md transition-all duration-200">
                  <div className="flex items-center justify-between text-sm mb-3">
                    <span className="text-gray-600 dark:text-gray-300">
                      Detected Tenstorrent board:
                    </span>
                    <div className="px-2 py-2">
                      {currentBoard !== "unknown" ? (
                        <BoardBadge
                          boardName={currentBoard}
                          onClick={() => {
                            const lower = currentBoard.toLowerCase();
                            if (
                              lower.includes("t3k") ||
                              lower.includes("t3000")
                            ) {
                              window.open(
                                "https://tenstorrent.com/hardware/tt-quietbox",
                                "_blank"
                              );
                            } else if (lower.includes("n300")) {
                              window.open(
                                "https://tenstorrent.com/hardware/wormhole",
                                "_blank"
                              );
                            } else {
                              window.open(
                                "https://www.tenstorrent.com/hardware",
                                "_blank"
                              );
                            }
                          }}
                        />
                      ) : (
                        <span className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                          Unknown
                        </span>
                      )}
                    </div>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-300">
                            Board compatibility:
                          </span>
                          <div className="flex items-center gap-4">
                            <span className="flex items-center gap-1">
                              <span className="text-green-500 text-xs">●</span>
                              <span className="text-gray-700 dark:text-gray-200">
                                {
                                  models.filter(
                                    (model) => model.is_compatible === true
                                  ).length
                                }{" "}
                                compatible
                              </span>
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="text-red-500 text-xs">●</span>
                              <span className="text-gray-700 dark:text-gray-200">
                                {
                                  models.filter(
                                    (model) => model.is_compatible === false
                                  ).length
                                }{" "}
                                incompatible
                              </span>
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="text-yellow-500 text-xs">●</span>
                              <span className="text-gray-700 dark:text-gray-200">
                                {
                                  models.filter(
                                    (model) => model.is_compatible === null
                                  ).length
                                }{" "}
                                unknown
                              </span>
                            </span>
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        align="start"
                        sideOffset={4}
                        className="max-w-sm text-xs text-left leading-relaxed"
                      >
                        <div className="font-semibold mb-1">
                          Board Compatibility
                        </div>
                        <div>
                          <span className="text-green-500 font-bold">
                            Compatible
                          </span>
                          <span>: Model will run on your detected board.</span>
                        </div>
                        <div>
                          <span className="text-red-500 font-bold">
                            Incompatible
                          </span>
                          <span>: Model will not run on your board.</span>
                        </div>
                        <div>
                          <span className="text-yellow-500 font-bold">
                            Unknown
                          </span>
                          <span>
                            : Board detection failed; compatibility cannot be
                            determined.
                          </span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}

              <FormMessage className="text-red-500 dark:text-red-300">
                {form.formState.errors.model?.message}
              </FormMessage>
            </FormItem>
          )}
        />
        <StepperFormActions
          form={form}
          removeDynamicSteps={() => {}}
          isSubmitting={isSubmitting}
        />
      </form>
    </Form>
  );
}
