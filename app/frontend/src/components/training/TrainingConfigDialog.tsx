// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { AlertTriangle, Info, Loader2 } from "lucide-react";

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
import { useTour } from "../../hooks/useTour";
import { FINE_TUNE_TOUR_ID } from "../tour/tours/fineTuneModel";
import { Button } from "../ui/button";
import {
  fetchTrainingCatalogFull,
  fetchCustomDatasets,
  fetchCustomDatasetContent,
  createTrainingJob,
  CUSTOM_DATASET_LOADER,
  type CatalogEntry,
  type CustomDataset,
} from "../../api/trainingApi";
import {
  parseDatasetFile,
  buildSampledPreview,
  deriveColumns,
  estimateRowTokenLengths,
  inferColumnMapping,
  MAX_ROWS_FOR_TOKEN_ESTIMATE,
  type DatasetRow,
} from "./datasetPreview";
import { customToast } from "../CustomToaster";

// Prefix marking custom datasets in the shared dropdown, so we can tell them
// apart at submit time and send the custom-dataset contract.
const CUSTOM_DATASET_PREFIX = "custom:";

// Radix Select can't use an empty-string item value, so the "no eval dataset"
// choice uses this sentinel and is mapped back to "" in the form.
const EVAL_DATASET_NONE = "__none__";

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

// Fixed Alpaca wrapper text (mirrors blacksmith's alpaca template) so the token
// estimate counts template boilerplate, not just the field values.
const ALPACA_HEADER_WITH_INPUT =
  "Below is an instruction that describes a task, paired with an input that provides further context. Write a response that appropriately completes the request.";
const ALPACA_HEADER_NO_INPUT =
  "Below is an instruction that describes a task. Write a response that appropriately completes the request.";

// Render a row as the full prompt a template produces, for the token estimate.
// Unknown templates fall back to concatenating the field values.
function renderTemplatePrompt(
  templateId: string,
  fields: Record<string, string>,
): string {
  if (templateId === "alpaca") {
    const instruction = fields.instruction ?? "";
    const input = fields.input ?? "";
    const output = fields.output ?? "";
    const header = input.trim()
      ? ALPACA_HEADER_WITH_INPUT
      : ALPACA_HEADER_NO_INPUT;
    const inputBlock = input.trim() ? `\n\n### Input:\n${input}` : "";
    return `${header}\n\n### Instruction:\n${instruction}${inputBlock}\n\n### Response:\n${output}`;
  }
  return Object.values(fields).join(" ");
}

// https://github.com/tenstorrent/tt-blacksmith/blob/main/blacksmith/experiments/torch/gemma/single_chip/gemma_sst2.yaml
const formSchema = z.object({
  model: z.string().min(1, "Select a model"),
  dataset: z.string().min(1, "Select a dataset"),
  // Optional evaluation/validation dataset (custom datasets only). Empty = none.
  eval_dataset: z.string().default(""),
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

  // While the fine-tune tour is driving this dialog, run it non-modally so the
  // tour tooltip stays clickable (a modal Radix dialog disables pointer events
  // on the rest of the page) and ignore outside clicks so stepping through the
  // tour does not dismiss it.
  const { run: tourRun, activeTourId } = useTour();
  const isFineTuneTour = tourRun && activeTourId === FINE_TUNE_TOUR_ID;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      model: "",
      dataset: "",
      eval_dataset: "",
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
      .catch(() => customToast.error("Failed to load fine-tuning catalog"))
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

  // Clear the eval dataset whenever the train dataset changes: the eval split is
  // only valid for custom datasets and must differ from the chosen train file.
  useEffect(() => {
    form.setValue("eval_dataset", "");
  }, [selectedDataset, form]);

  // Custom datasets available as an eval split — every uploaded dataset except
  // the one already chosen as the train set.
  const selectedTrainCustomId = isCustomDataset
    ? selectedDataset.slice(CUSTOM_DATASET_PREFIX.length)
    : "";
  const evalDatasetOptions = customDatasets.filter(
    (ds) => ds.id !== selectedTrainCustomId,
  );

  const selectedTemplate = form.watch("template");
  const templateFields = useMemo(
    () => DATASET_TEMPLATES.find((t) => t.id === selectedTemplate)?.fields ?? [],
    [selectedTemplate],
  );

  // Sample of the selected custom dataset, used to warn before submit when
  // examples exceed max_length (the trainer silently drops over-length rows).
  const [datasetSampleRows, setDatasetSampleRows] = useState<DatasetRow[]>([]);
  // Column names seen in the sample, and whether the sample is only a leading
  // slice of a large file (in which case its row count says nothing useful).
  const [datasetColumns, setDatasetColumns] = useState<string[]>([]);
  const [datasetSampled, setDatasetSampled] = useState(false);
  const maxLength = form.watch("max_length");
  const columnMapping = form.watch("column_mapping");

  useEffect(() => {
    if (!open || !isCustomDataset) {
      setDatasetSampleRows([]);
      setDatasetColumns([]);
      setDatasetSampled(false);
      return;
    }
    const datasetId = selectedDataset.slice(CUSTOM_DATASET_PREFIX.length);
    let cancelled = false;
    fetchCustomDatasetContent(datasetId)
      .then(({ text, sampled }) => {
        if (cancelled) return;
        // Extract up to the estimate cap (not the preview default of 50) so the
        // sampled path still gives a representative sample for the token warning.
        const preview = sampled
          ? buildSampledPreview(text, MAX_ROWS_FOR_TOKEN_ESTIMATE)
          : parseDatasetFile(text);
        setDatasetSampleRows(preview.rows);
        setDatasetColumns(deriveColumns(preview.rows));
        setDatasetSampled(sampled);
      })
      // Best-effort: a fetch/parse failure just skips the warning.
      .catch(() => {
        if (!cancelled) {
          setDatasetSampleRows([]);
          setDatasetColumns([]);
          setDatasetSampled(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, isCustomDataset, selectedDataset]);

  // Pre-fill the column mapping from the dataset's own columns (e.g. a
  // prompt/completion file maps to instruction/output) whenever the dataset or
  // template changes. Same-named columns need no mapping and stay blank.
  useEffect(() => {
    if (!isCustomDataset) return;
    const fields =
      DATASET_TEMPLATES.find((t) => t.id === selectedTemplate)?.fields ?? [];
    const inferred = inferColumnMapping(
      datasetColumns,
      fields.map((f) => f.key),
    );
    form.setValue(
      "column_mapping",
      fields.map((f) => ({ value: inferred[f.key] ?? "" })),
    );
  }, [datasetColumns, selectedTemplate, isCustomDataset, form]);

  // Template fields that neither exist as a column nor could be inferred.
  const unresolvedRequiredFields = useMemo(() => {
    if (!isCustomDataset || datasetColumns.length === 0) return [];
    const present = new Set(datasetColumns);
    return templateFields
      .filter((f, i) => {
        if (!f.required) return false;
        const mapped = (columnMapping[i]?.value ?? "").trim();
        return mapped ? !present.has(mapped) : !present.has(f.key);
      })
      .map((f) => f.key);
  }, [isCustomDataset, datasetColumns, templateFields, columnMapping]);

  // Optimizer steps this run will take (floor(rows / batch) * epochs, capped by
  // Max Steps). Metrics, validation and checkpoints only fire on steps divisible
  // by their frequency, so anything above this total never fires. The backend
  // lowers such frequencies to this value when the job is created.
  const batchSize = form.watch("batch_size");
  const numEpochs = form.watch("num_epochs");
  const maxSteps = form.watch("max_steps");
  const stepsFreq = form.watch("steps_freq");
  const valStepsFreq = form.watch("val_steps_freq");
  const saveInterval = form.watch("save_interval");
  const estimatedTotalSteps = useMemo(() => {
    if (!isCustomDataset || datasetSampled || datasetSampleRows.length === 0) {
      return null;
    }
    const batch = Number(batchSize) > 0 ? Math.floor(Number(batchSize)) : 1;
    const epochs = Number(numEpochs) > 0 ? Math.floor(Number(numEpochs)) : 1;
    let steps =
      Math.max(1, Math.floor(datasetSampleRows.length / batch)) * epochs;
    const cap = Number(maxSteps);
    if (cap > 0) steps = Math.min(steps, Math.floor(cap));
    return Math.max(1, steps);
  }, [
    isCustomDataset,
    datasetSampled,
    datasetSampleRows,
    batchSize,
    numEpochs,
    maxSteps,
  ]);
  const frequencyExceedsRun =
    estimatedTotalSteps !== null &&
    [stepsFreq, valStepsFreq, saveInterval].some(
      (v) => Number(v) > estimatedTotalSteps,
    );

  // Estimated token length (template boilerplate included) of each example in
  // the sample, over the mapped columns (or each field's own name when unmapped).
  const sampleTokenLengths = useMemo(() => {
    if (datasetSampleRows.length === 0) return [];
    const columns = templateFields.map(
      (f, i) => (columnMapping[i]?.value ?? "").trim() || f.key,
    );
    return estimateRowTokenLengths(datasetSampleRows, (row) => {
      const fields: Record<string, string> = {};
      templateFields.forEach((f, i) => {
        const v = row[columns[i]];
        fields[f.key] = v === null || v === undefined ? "" : String(v);
      });
      return renderTemplatePrompt(selectedTemplate, fields);
    });
  }, [datasetSampleRows, templateFields, columnMapping, selectedTemplate]);

  // How much of the sample the trainer would keep at the configured max_length
  // (examples longer than it are silently dropped). Recomputes as max_length edits.
  const validMaxLength = Number.isFinite(maxLength) && maxLength > 0;
  const sampleTotal = sampleTokenLengths.length;
  const sampleKept = useMemo(() => {
    if (!validMaxLength) return sampleTotal;
    return sampleTokenLengths.filter((len) => len <= maxLength).length;
  }, [sampleTokenLengths, maxLength, validMaxLength, sampleTotal]);

  // Rounded, but never round a non-zero share down to "0%" (shown as "<1%").
  const rawPercent = sampleTotal > 0 ? (sampleKept / sampleTotal) * 100 : 100;
  const includedPercentLabel =
    sampleKept > 0 && rawPercent < 1 ? "<1" : String(Math.round(rawPercent));

  const lengthWarning =
    isCustomDataset && sampleTotal > 0 && validMaxLength && sampleKept < sampleTotal;

  const onSubmit = async (values: FormValues) => {
    if (!device) {
      customToast.error(
        "Could not determine the fine-tuning device from the catalog.",
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

        // Optional eval/validation split. Shares template + column mapping with
        // the train set; the backend stages it into val_dataset_path.
        if (values.eval_dataset) {
          params.custom_eval_dataset = values.eval_dataset;
        }
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
          ? `Failed to create fine-tuning job: ${message}`
          : "Failed to create fine-tuning job",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={!isFineTuneTour}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => {
          if (isFineTuneTour) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>New Fine-tuning Job</DialogTitle>
          <DialogDescription>
            Configure fine-tuning parameters and submit a fine-tuning job.
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
                  <FormItem data-tour="training-dialog-model">
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
                  <FormItem data-tour="training-dialog-dataset">
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
                  Choose how the fine-tuning server formats your data.
                </p>
                <FormField
                  control={form.control}
                  name="eval_dataset"
                  render={({ field }) => (
                    <FormItem className="mb-4 max-w-xs">
                      <FormLabel className="text-xs">
                        Evaluation Dataset{" "}
                        <span className="font-normal text-gray-400">
                          (optional)
                        </span>
                      </FormLabel>
                      <Select
                        onValueChange={(value) =>
                          field.onChange(
                            value === EVAL_DATASET_NONE ? "" : value,
                          )
                        }
                        value={field.value || EVAL_DATASET_NONE}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={EVAL_DATASET_NONE}>None</SelectItem>
                          {evalDatasetOptions.map((ds) => (
                            <SelectItem key={ds.id} value={ds.id}>
                              {ds.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Runs validation during training (needs Validation Freq
                        &gt; 0). Must share the same columns as the train set.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                    Detected columns are filled in automatically
                    {datasetColumns.length > 0 && (
                      <>
                        {" "}
                        (found:{" "}
                        <span className="font-mono">
                          {datasetColumns.join(", ")}
                        </span>
                        )
                      </>
                    )}
                    .
                  </p>
                  {unresolvedRequiredFields.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-700/60 dark:bg-amber-900/20">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <p className="text-amber-800 dark:text-amber-200">
                        No dataset column found for{" "}
                        <span className="font-semibold">
                          {unresolvedRequiredFields.join(", ")}
                        </span>
                        . Enter the column name(s) below or the job will fail
                        to start.
                      </p>
                    </div>
                  )}
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
            <div data-tour="training-dialog-hyperparameters">
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

              {lengthWarning && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-700/60 dark:bg-amber-900/20">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <p className="text-amber-800 dark:text-amber-200">
                      At a Sequence Length of{" "}
                      <span className="font-semibold">{maxLength}</span>, only
                      about{" "}
                      <span className="font-semibold">
                        {includedPercentLabel}%
                      </span>{" "}
                      of examples would be used for training (estimated, template
                      included) — examples longer than the limit are silently
                      dropped.{" "}
                      {sampleKept === 0
                        ? "Every sampled example exceeds the limit, so fine-tuning would fail with an empty dataset."
                        : "Raise Sequence Length to include more examples."}
                    </p>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs dark:border-blue-700/60 dark:bg-blue-900/20">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    <p className="text-blue-800 dark:text-blue-200">
                      Raising Sequence Length increases memory use — you may need
                      to lower Batch Size to avoid out-of-memory (OOM) errors.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* LoRA Config */}
            <div data-tour="training-dialog-lora">
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

              {frequencyExceedsRun && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs dark:border-blue-700/60 dark:bg-blue-900/20">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  <p className="text-blue-800 dark:text-blue-200">
                    This dataset trains for about{" "}
                    <span className="font-semibold">
                      {estimatedTotalSteps} step
                      {estimatedTotalSteps === 1 ? "" : "s"}
                    </span>{" "}
                    at the current Batch Size and Epochs. Frequencies above that
                    would never fire, so they are lowered to{" "}
                    <span className="font-semibold">{estimatedTotalSteps}</span>{" "}
                    when the job starts so metrics and a checkpoint are still
                    recorded.
                  </p>
                </div>
              )}
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
              <Button
                type="submit"
                disabled={submitting}
                data-tour="training-dialog-submit"
              >
                {submitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Start Fine-tuning
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
