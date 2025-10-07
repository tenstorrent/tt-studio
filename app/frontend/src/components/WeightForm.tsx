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
import { Weight, getWeightsUrl } from "./SelectionSteps";

export function WeightForm({
  selectedModel,
  setCustomWeight,
  setFormError,
}: {
  selectedModel: string | null;
  setCustomWeight: (weight: Weight) => void;
  setFormError: (hasError: boolean) => void;
}) {
  const { nextStep } = useStepper();
  const [weights, setWeights] = useState<Weight[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (selectedModel) {
      console.log("fetching weights", getWeightsUrl(selectedModel));
      const fetchWeights = async () => {
        try {
          const response = await axios.get<Weight[]>(
            getWeightsUrl(selectedModel)
          );
          console.log("fetched weights:", response.data);
          setWeights(response.data);
        } catch (error) {
          console.error("Error fetching weights:", error);
        }
      };

      fetchWeights();
    }
  }, [selectedModel]);

  const form = useForm({
    resolver: zodResolver(
      z.object({
        weight: z.string().nonempty("Please select a weight file."),
      })
    ),
    defaultValues: {
      weight: "",
    },
  });

  useEffect(() => {
    setFormError(!!form.formState.errors.weight);
  }, [form.formState.errors]);

  const onSubmit = async (data: { weight: string }) => {
    setIsSubmitting(true);
    try {
      const selectedWeight = weights.find(
        (weight) => weight.name === data.weight
      );
      if (selectedWeight) {
        setCustomWeight(selectedWeight);
        customToast.success("Model Weight Selected!");
        setFormError(false);
        nextStep();
      } else {
        customToast.error("Weight not found!");
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
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="weight"
          render={({ field }) => (
            <FormItem className="w-full mb-4 p-8">
              <FormLabel className="text-lg font-semibold text-gray-800 dark:text-white">
                Weight
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
                    <SelectValue placeholder="Select a weight" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {weights.map((weight) => (
                    <SelectItem key={weight.weights_id} value={weight.name}>
                      {weight.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage>{form.formState.errors.weight?.message}</FormMessage>
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
