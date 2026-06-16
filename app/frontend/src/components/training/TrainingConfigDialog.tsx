// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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
  fetchTrainingCatalog,
  createTrainingJob,
  type CatalogEntry,
} from "../../api/trainingApi";
import { customToast } from "../CustomToaster";

const formSchema = z.object({
  model: z.string().min(1, "Select a model"),
  dataset: z.string().min(1, "Select a dataset"),
  learning_rate: z.coerce.number().positive().default(5e-5),
  batch_size: z.coerce.number().int().positive().default(8),
  num_epochs: z.coerce.number().int().positive().default(3),
  max_steps: z.coerce.number().int().nonnegative().default(0),
  lora_rank: z.coerce.number().int().positive().default(8),
  lora_alpha: z.coerce.number().int().positive().default(16),
  lora_target_modules: z.string().default("q_proj,v_proj"),
  val_steps_freq: z.coerce.number().int().nonnegative().default(50),
  save_interval: z.coerce.number().int().nonnegative().default(100),
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
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      model: "",
      dataset: "",
      learning_rate: 5e-5,
      batch_size: 8,
      num_epochs: 3,
      max_steps: 0,
      lora_rank: 8,
      lora_alpha: 16,
      lora_target_modules: "q_proj,v_proj",
      val_steps_freq: 50,
      save_interval: 100,
    },
  });

  useEffect(() => {
    if (!open) return;
    setCatalogLoading(true);
    fetchTrainingCatalog()
      .then(setCatalog)
      .catch(() => customToast.error("Failed to load training catalog"))
      .finally(() => setCatalogLoading(false));
  }, [open]);

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await createTrainingJob({
        ...values,
        lora_target_modules: values.lora_target_modules
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        max_steps: values.max_steps || undefined,
        val_steps_freq: values.val_steps_freq || undefined,
        save_interval: values.save_interval || undefined,
      });
      form.reset();
      onJobCreated();
    } catch (err) {
      console.error("Failed to create training job:", err);
      customToast.error("Failed to create training job");
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
                    <FormControl>
                      <Input placeholder="e.g. SST2, Alpaca" {...field} />
                    </FormControl>
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
              <div className="grid grid-cols-2 gap-4">
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
