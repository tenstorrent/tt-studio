// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
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
import { SecondStepFormProps } from "./SelectionSteps";

const SecondFormSchema = z.object({
  weight: z.string().nonempty("Please select a weight."),
});
export function SecondStepForm({
  setSelectedWeight,
  addCustomStep,
  addFineTuneStep,
  removeDynamicSteps,
  setFormError,
}: SecondStepFormProps & {
  setSelectedWeight: (weight: string) => void;
  selectedModel: string | null;
  setFormError: (hasError: boolean) => void;
}) {
  const { nextStep } = useStepper();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<z.infer<typeof SecondFormSchema>>({
    resolver: zodResolver(SecondFormSchema),
    defaultValues: {
      weight: "",
    },
  });

  useEffect(() => {
    setFormError(!!form.formState.errors.weight);
  }, [form.formState.errors]);

  const onSubmit = async (data: z.infer<typeof SecondFormSchema>) => {
    setIsSubmitting(true);
    try {
      const selectedWeight = data.weight;
      if (selectedWeight) {
        setSelectedWeight(selectedWeight);
        customToast.success("Model Weights Selected!");
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
                  removeDynamicSteps();
                  if (value === "Custom Weight") {
                    addCustomStep();
                  } else if (value === "Fine-Tune Weights") {
                    addFineTuneStep();
                  }
                }}
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a weight" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="Default Weights">
                    Default Weights
                  </SelectItem>
                  <SelectItem value="Custom Weight">Custom Weight</SelectItem>
                  <SelectItem value="Fine-Tune Weights">
                    Fine-Tune Weights
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage className="text-red-500 dark:text-red-300">
                {form.formState.errors.weight?.message}
              </FormMessage>
            </FormItem>
          )}
        />
        <StepperFormActions
          form={form}
          removeDynamicSteps={removeDynamicSteps}
          isSubmitting={isSubmitting}
        />
      </form>
    </Form>
  );
}
