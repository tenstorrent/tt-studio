// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useStepper } from "./ui/stepper";
import { customToast } from "./CustomToaster";
import { StepperFormActions } from "./StepperFormActions";

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

function getAllCombinations(arr: number[]) {
    const results = [];
  
    const total = Math.pow(2, arr.length);
  
    for (let i = 1; i < total; i++) {
      const combo = [];
      for (let j = 0; j < arr.length; j++) {
        if (i & (1 << j)) {
          combo.push(arr[j]);
        }
      }
      results.push(combo);
    }
  
    // Sort by length (ascending)
    results.sort((a, b) => a.length - b.length);
  
    return results.map(subArr => subArr.join(", "));
  }

// TODO: THIS SHOULD COME FROM BACKEND
const DEVICE_CONFIGURATIONS = getAllCombinations([0, 1, 2, 3]);

const FirstFormSchema = z.object({
  devices: z.string().nonempty("You must select one or more devices."),
});

export function DeviceSelectionStep({
    setSelectedDevices,
    setFormError
}: {
  setSelectedDevices: (devices: string) => void;
  setFormError: (hasError: boolean) => void;
}) {
  const { nextStep } = useStepper();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (data: z.infer<typeof FirstFormSchema>) => {
    setIsSubmitting(true);
    try {
      const selectedDevices = data.devices;
      if (selectedDevices) {
        setSelectedDevices(selectedDevices);
        // TODO: SINGULAR VS MULTI DEVICE TEXT
        customToast.success("Device(s) Selected!: " + selectedDevices);
        setFormError(false);
        nextStep();
      } else {
        customToast.error("No devices were found!");
        setFormError(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const form = useForm<z.infer<typeof FirstFormSchema>>({
    resolver: zodResolver(FirstFormSchema),
    defaultValues: {
      devices: "",
    },
  });

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
          name="devices"
          render={({ field }) => (
            <FormItem className="w-full mb-4 p-8">
              <FormLabel className="text-lg font-semibold text-gray-800 dark:text-white">
                Devices
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
                    <SelectValue placeholder="Select one or more devices to deploy the model on" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {DEVICE_CONFIGURATIONS.map((device_configuration, idx) => (
                    <SelectItem key={idx} value={device_configuration}>
                      {device_configuration}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage className="text-red-500 dark:text-red-300">
                {form.formState.errors.devices?.message}
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
