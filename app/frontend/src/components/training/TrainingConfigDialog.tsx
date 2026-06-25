// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import {
  fetchTrainingCatalogFull,
  createTrainingJob,
  type CatalogEntry,
} from "../../api/trainingApi";
import { customToast } from "../CustomToaster";

// Default hyperparameters mirror the reference gemma_sst2 single-chip recipe:
// https://github.com/tenstorrent/tt-blacksmith/blob/main/blacksmith/experiments/torch/gemma/single_chip/gemma_sst2.yaml
const formSchema = z.object({
  model: z.string().min(1, "Select a model"),
  dataset: z.string().min(1, "Select a dataset"),
  learning_rate: z.coerce.number().positive().default(6e-5),
  batch_size: z.coerce.number().int().positive().default(8),
  num_epochs: z.coerce.number().int().positive().default(1),
  max_length: z.coerce.number().int().positive().default(32),
  max_steps: z.coerce.number().int().nonnegative().default(100),
  lora_rank: z.coerce.number().int().positive().default(4),
  lora_alpha: z.coerce.number().int().positive().default(8),
  lora_target_modules: z.string().default("q_proj,v_proj"),
  steps_freq: z.coerce.number().int().nonnegative().default(10),
  val_steps_freq: z.coerce.number().int().nonnegative().default(25),
  save_interval: z.coerce.number().int().nonnegative().default(25),
});

type FormValues = z.infer<typeof formSchema>;

interface TrainingConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobCreated: () => void;
}

export function TrainingConfigDialog({
  open,
  onOpenChange,
  onJobCreated,
}: TrainingConfigDialogProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [datasets, setDatasets] = useState<CatalogEntry[]>([]);
  const [device, setDevice] = useState<string | undefined>(undefined);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      model: "",
      dataset: "",
      learning_rate: 6e-5,
      batch_size: 8,
      num_epochs: 1,
      max_length: 32,
      max_steps: 100,
      lora_rank: 4,
      lora_alpha: 8,
      lora_target_modules: "q_proj,v_proj",
      steps_freq: 10,
      val_steps_freq: 25,
      save_interval: 25,
    },
  });

  useEffect(() => {
    if (!open) return;
    setCatalogLoading(true);
    fetchTrainingCatalogFull()
      .then(({ models, datasets: datasetEntries, device: catalogDevice }) => {
        setCatalog(models);
        setDatasets(datasetEntries);
        setDevice(catalogDevice);
      })
      .catch(() => customToast.error("Failed to load training catalog"))
      .finally(() => setCatalogLoading(false));
  }, [open]);

  // Reset the dataset selection whenever the model changes so the user must
  // (re)choose a dataset that is valid for the newly selected model.
  const selectedModel = form.watch("model");
  useEffect(() => {
    form.setValue("dataset", "");
  }, [selectedModel, form]);

  const onSubmit = async (values: FormValues) => {
    if (!device) {
      customToast.error(
        "Could not determine the training device from the catalog.",
      );
      return;
    }
    setSubmitting(true);
    try {
      // Map form fields to the container's `TrainingRequest` schema. Field names
      // must match exactly (e.g. `dataset_loader`, `lora_r`) or they are dropped.
      await createTrainingJob({
        dataset_loader: values.dataset,
        device_type: device,
        learning_rate: values.learning_rate,
        batch_size: values.batch_size,
        num_epochs: values.num_epochs,
        max_length: values.max_length,
        lora_alpha: values.lora_alpha,
        lora_r: values.lora_rank,
        lora_target_modules: values.lora_target_modules
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        max_steps: values.max_steps || undefined,
        steps_freq: values.steps_freq || undefined,
        val_steps_freq: values.val_steps_freq || undefined,
        save_interval: values.save_interval || undefined,
      });
      form.reset();
      onJobCreated();
    } catch (err) {
      console.error("Failed to create training job:", err);
      const detail =
        (err as { response?: { data?: { error?: string; detail?: unknown } } })
          ?.response?.data;
      const message =
        detail?.error ||
        (typeof detail?.detail === "string"
          ? detail.detail
          : detail?.detail
            ? JSON.stringify(detail.detail)
            : undefined);
      customToast.error(
        message
          ? `Failed to create training job: ${message}`
          : "Failed to create training job",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Training Job</DialogTitle>
          <DialogDescription>
            Configure fine-tuning parameters and submit a training job.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Model & Dataset */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={catalogLoading}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              catalogLoading ? "Loading..." : "Select model"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {catalog.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {entry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dataset"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dataset</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={catalogLoading || !selectedModel}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              !selectedModel
                                ? "Select a model first"
                                : catalogLoading
                                  ? "Loading..."
                                  : "Select dataset"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {datasets.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {entry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Hyperparameters */}
            <div>
              <h4 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                Hyperparameters
              </h4>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <FormField
                  control={form.control}
                  name="learning_rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Learning Rate</FormLabel>
                      <FormControl>
                        <Input type="number" step="any" disabled {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="batch_size"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Batch Size</FormLabel>
                      <FormControl>
                        <Input type="number" disabled {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="num_epochs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Epochs</FormLabel>
                      <FormControl>
                        <Input type="number" disabled {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="max_length"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Sequence Length</FormLabel>
                      <FormControl>
                        <Input type="number" disabled {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* LoRA Config */}
            <div>
              <h4 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                LoRA Configuration
              </h4>
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="lora_rank"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Rank</FormLabel>
                      <FormControl>
                        <Input type="number" disabled {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lora_alpha"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Alpha</FormLabel>
                      <FormControl>
                        <Input type="number" disabled {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lora_target_modules"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Target Modules</FormLabel>
                      <FormControl>
                        <Input placeholder="q_proj,v_proj" disabled {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Validation & Checkpointing */}
            <div>
              <h4 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                Validation &amp; Checkpointing
              </h4>
              <div className="grid grid-cols-2 items-end gap-4 sm:grid-cols-4">
                <FormField
                  control={form.control}
                  name="steps_freq"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">
                        Logging Freq (steps)
                      </FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="val_steps_freq"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">
                        Validation Freq (steps)
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="0 = no validation"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="save_interval"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">
                        Checkpoint Interval (steps)
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="0 = end only"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="max_steps"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Max Steps</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="0 = unlimited"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Start Training
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
