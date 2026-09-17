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
  fetchCustomDatasets,
  createTrainingJob,
  CUSTOM_DATASET_LOADER,
  type CatalogEntry,
  type CustomDataset,
} from "../../api/trainingApi";
import { customToast } from "../CustomToaster";

// Prefix marking custom datasets in the shared dropdown, so we can tell them
// apart at submit time and send the custom-dataset contract.
const CUSTOM_DATASET_PREFIX = "custom:";

// Prompt templates the custom-dataset loader supports. No API lists these, so
// keep in sync with blacksmith's custom_dataset_utils.py. `key` is the field the
// server reads from each row; the user maps it to a column in their dataset.
const DATASET_TEMPLATES = [
  {
    id: "alpaca",
    label: "Alpaca",
    fields: [
      { key: "instruction", required: true },
      { key: "input", required: false },
      { key: "output", required: true },
    ],
  },
] as const;

const DEFAULT_TEMPLATE = DATASET_TEMPLATES[0].id;

// https://github.com/tenstorrent/tt-blacksmith/blob/main/blacksmith/experiments/torch/gemma/single_chip/gemma_sst2.yaml
const formSchema = z.object({
  model: z.string().min(1, "Select a model"),
  dataset: z.string().min(1, "Select a dataset"),
  template: z.string().default(DEFAULT_TEMPLATE),
  column_mapping: z
    .array(z.object({ value: z.string().default("") }))
    .default([]),
  learning_rate: z.coerce.number().positive().default(6e-5),
  batch_size: z.coerce.number().int().positive().default(8),
  num_epochs: z.coerce.number().int().positive().default(1),
  max_length: z.coerce.number().int().positive().default(128),
  max_steps: z.coerce.number().int().nonnegative().default(100),
  lora_rank: z.coerce.number().int().positive().default(4),
  lora_alpha: z.coerce.number().int().positive().default(8),
  lora_target_modules: z.string().default("q_proj,v_proj"),
  // Unlike the other frequencies, 0 is not a valid logging frequency: the
  // container feeds this straight into `MetricsConfig.steps_freq`, which is
  // `Field(ge=1)`, and the metrics callback uses it as a modulo divisor.
  steps_freq: z.coerce
    .number()
    .int()
    .positive("Logging frequency must be at least 1")
    .default(10),
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
  const [customDatasets, setCustomDatasets] = useState<CustomDataset[]>([]);
  const [device, setDevice] = useState<string | undefined>(undefined);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      model: "",
      dataset: "",
      template: DEFAULT_TEMPLATE,
      column_mapping: [],
      learning_rate: 6e-5,
      batch_size: 8,
      num_epochs: 1,
      max_length: 128,
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
    Promise.all([fetchTrainingCatalogFull(), fetchCustomDatasets()])
      .then(
        ([
          { models, datasets: datasetEntries, device: catalogDevice },
          custom,
        ]) => {
          setCatalog(models);
          setDatasets(datasetEntries);
          setCustomDatasets(custom);
          setDevice(catalogDevice);
        },
      )
      .catch(() => customToast.error("Failed to load training catalog"))
      .finally(() => setCatalogLoading(false));
  }, [open]);

  // Reset the dataset selection whenever the model changes so the user must
  // (re)choose a dataset that is valid for the newly selected model.
  const selectedModel = form.watch("model");
  useEffect(() => {
    form.setValue("dataset", "");
  }, [selectedModel, form]);

  const selectedDataset = form.watch("dataset");
  const isCustomDataset = selectedDataset.startsWith(CUSTOM_DATASET_PREFIX);

  const selectedTemplate = form.watch("template");
  const templateFields =
    DATASET_TEMPLATES.find((t) => t.id === selectedTemplate)?.fields ?? [];

  const onSubmit = async (values: FormValues) => {
    if (!device) {
      customToast.error(
        "Could not determine the training device from the catalog.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const isCustom = values.dataset.startsWith(CUSTOM_DATASET_PREFIX);
      const loraTargetModules = values.lora_target_modules
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const params: Parameters<typeof createTrainingJob>[0] = {
        dataset_loader: isCustom ? CUSTOM_DATASET_LOADER : values.dataset,
        device_type: device,
        learning_rate: values.learning_rate,
        batch_size: values.batch_size,
        num_epochs: values.num_epochs,
        dataset_max_sequence_length: values.max_length,
        lora_alpha: values.lora_alpha,
        lora_r: values.lora_rank,
        max_steps: values.max_steps,
        steps_freq: values.steps_freq,
        val_steps_freq: values.val_steps_freq,
        save_interval: values.save_interval,
      };
      // Omit when blank so the server keeps its own default instead of getting [].
      if (loraTargetModules.length > 0) {
        params.lora_target_modules = loraTargetModules;
      }

      if (isCustom) {
        // Backend stages the named upload into `train_dataset_path`. Uploads are
        // JSON arrays of objects, so `file_type` is "json".
        params.custom_dataset = values.dataset.slice(CUSTOM_DATASET_PREFIX.length);
        params.file_type = "json";
        params.template = values.template || DEFAULT_TEMPLATE;
        // Map each template field to a column; blanks are omitted so the server
        // falls back to the identically named column.
        const fields =
          DATASET_TEMPLATES.find((t) => t.id === values.template)?.fields ?? [];
        const mapping: Record<string, string> = {};
        fields.forEach((f, i) => {
          const v = (values.column_mapping[i]?.value ?? "").trim();
          if (v) mapping[f.key] = v;
        });
        if (Object.keys(mapping).length > 0) params.column_mapping = mapping;
      }

      await createTrainingJob(params);
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
                        {customDatasets.length > 0 && (
                          <>
                            <div className="px-2 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                              Custom Datasets
                            </div>
                            {customDatasets.map((ds) => (
                              <SelectItem
                                key={`${CUSTOM_DATASET_PREFIX}${ds.id}`}
                                value={`${CUSTOM_DATASET_PREFIX}${ds.id}`}
                              >
                                {ds.name}
                              </SelectItem>
                            ))}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Custom dataset options (only for user-uploaded datasets) */}
            {isCustomDataset && (
              <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <h4 className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
                  Custom Dataset
                </h4>
                <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                  Choose how the training server formats your data.
                </p>
                <FormField
                  control={form.control}
                  name="template"
                  render={({ field }) => (
                    <FormItem className="mb-4 max-w-xs">
                      <FormLabel className="text-xs">Prompt Template</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select template" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DATASET_TEMPLATES.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="space-y-2">
                  <FormLabel className="text-xs">
                    Column Mapping{" "}
                    <span className="font-normal text-gray-400">(optional)</span>
                  </FormLabel>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Map each template field to a column in your dataset.
                  </p>
                  {templateFields.map((f, index) => (
                    <div key={f.key} className="flex items-center gap-2">
                      <span className="w-36 shrink-0 text-sm text-gray-700 dark:text-gray-300">
                        {f.key}
                        {f.required ? (
                          <span className="text-red-500"> *</span>
                        ) : (
                          <span className="font-normal text-gray-400">
                            {" "}
                            (optional)
                          </span>
                        )}
                      </span>
                      <span className="text-gray-400">→</span>
                      <Input
                        aria-label={`Dataset column for the "${f.key}" field`}
                        placeholder={`your column (defaults to "${f.key}")`}
                        {...form.register(`column_mapping.${index}.value`)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                        <Input type="number" step="any" {...field} />
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
                        <Input type="number" {...field} />
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
                        <Input type="number" {...field} />
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
                        <Input type="number" {...field} />
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
                        <Input type="number" {...field} />
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
                        <Input type="number" {...field} />
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
                        <Input placeholder="q_proj,v_proj" {...field} />
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
