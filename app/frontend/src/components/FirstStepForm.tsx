// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import axios from "axios";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    console.log("fetching models", getModelsUrl);
    const fetchModels = async () => {
      try {
        const response = await axios.get<Model[]>(getModelsUrl);
        console.log("fetched models:", response.data);
        setModels(response.data);
      } catch (error) {
        console.error("Error fetching models:", error);
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
                Models
              </FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  setFormError(false);
                }}
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.name}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
