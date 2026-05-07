// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { customToast } from "./CustomToaster";
import {
  getSettings,
  updateSettings,
  type SettingsResponse,
} from "../api/settingsApi";

const formSchema = z.object({
  tavily_api_key: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: getSettings,
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { tavily_api_key: "" },
  });

  useEffect(() => {
    if (open) form.reset({ tavily_api_key: "" });
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (payload: FormValues) =>
      updateSettings({ tavily_api_key: (payload.tavily_api_key || "").trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      customToast.success("Settings saved.");
      onOpenChange(false);
    },
    onError: (err: any) => {
      customToast.error(
        err?.response?.data?.error || err?.message || "Failed to save settings."
      );
    },
  });

  const onSubmit = (values: FormValues) => mutation.mutate(values);

  const jwtMasked = data?.jwt_secret.masked;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Secrets are stored on the server in the persistent volume.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          autoComplete="off"
        >
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" /> JWT Secret
            </Label>
            <Input
              readOnly
              disabled
              value={
                isLoading ? "Loading..." : jwtMasked || "Auto-managed"
              }
            />
            <p className="text-xs text-stone-500">
              Auto-managed by the backend. Generated on first run and persisted
              across restarts.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tavily_api_key">Tavily API Key</Label>
            <Input
              id="tavily_api_key"
              type="password"
              autoComplete="new-password"
              placeholder={
                isLoading
                  ? "Loading..."
                  : data?.tavily_api_key.set
                    ? `Set (${data.tavily_api_key.masked}) – leave blank to keep`
                    : "Enter Tavily API key"
              }
              {...form.register("tavily_api_key")}
            />
            <p className="text-xs text-stone-500">
              Used by the search agent. Get a key at{" "}
              <a
                href="https://tavily.com"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                tavily.com
              </a>
              . Applied immediately to running agents — no redeploy needed.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
