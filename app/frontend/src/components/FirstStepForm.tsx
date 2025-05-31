// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import axios from "axios";
import { useEffect, useState } from "react";
import { Bot, Cpu, CheckCircle, XCircle } from "lucide-react";

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

// Add board type interface
interface BoardInfo {
  type: string;
  name: string;
}

const FirstFormSchema = z.object({
  model: z.string().nonempty("Please select a model."),
});

export function FirstStepForm({
  setSelectedModel,
  setFormError,
}: {
  setSelectedModel: (model: string) => void;
  setFormError: (hasError: boolean) => void;
}) {
  const { nextStep } = useStepper();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
        setSelectedModel(selectedModel.id);
        customToast.success("Model Selected!: " + selectedModel.name);
        setFormError(false);
        nextStep();
      } else {
        customToast.error("Model not found!");
        setFormError(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get current board info and separate compatible/incompatible models
  const currentBoard = models[0]?.current_board || "unknown";
  const compatibleModels = models.filter(
    (model) => model.is_compatible === true
  );
  const incompatibleModels = models.filter(
    (model) => model.is_compatible === false
  );

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit(onSubmit)();
        }}
        className="space-y-10"
      >
        <FormField
          control={form.control}
          name="model"
          render={({ field }) => (
            <FormItem className="w-full mb-4 p-8">
              <FormLabel className="text-lg font-semibold text-gray-800 dark:text-white">
                <div className="flex items-center gap-3 mb-4">
                  <span>Select Model</span>
                  {currentBoard !== "unknown" && (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                      <Cpu className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                        {currentBoard} Board
                      </span>
                    </div>
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
                  {/* Compatible Models Section */}
                  {compatibleModels.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20">
                        <CheckCircle className="w-3 h-3" />
                        <span>Compatible Models</span>
                      </div>
                      {compatibleModels.map((model) => (
                        <SelectItem
                          key={model.id}
                          value={model.name}
                          className="pl-4 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden"
                        >
                          <div className="flex items-center w-full">
                            <span className="text-green-500 mr-2">●</span>
                            <span>{model.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </>
                  )}

                  {/* Incompatible Models Section */}
                  {incompatibleModels.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 mt-1">
                        <XCircle className="w-3 h-3" />
                        <span>Incompatible Models</span>
                      </div>
                      {incompatibleModels.map((model) => (
                        <SelectItem
                          key={model.id}
                          value={model.name}
                          disabled={true}
                          className="pl-4 opacity-50 [&>*:first-child]:hidden [&_svg]:hidden [&_[data-radix-select-item-indicator]]:hidden"
                        >
                          <div className="flex items-center w-full">
                            <span className="text-red-500 mr-2">●</span>
                            <span className="text-gray-500">{model.name}</span>
                            <span className="ml-2 text-xs text-red-500">
                              (Requires T3000)
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </>
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
              {!isLoading && models.length > 0 && (
                <div className="flex items-center gap-2 mt-2 text-sm text-gray-600 dark:text-gray-300">
                  <Bot className="w-4 h-4" />
                  <span>
                    {compatibleModels.length} compatible,{" "}
                    {incompatibleModels.length} incompatible models
                  </span>
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
