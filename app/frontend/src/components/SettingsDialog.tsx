// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Lock } from "lucide-react";

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
import HfAccessCheck from "./HfAccessCheck";
import {
  getSettings,
  updateSettings,
  type SettingsResponse,
} from "../api/settingsApi";

const formSchema = z.object({
  hf_token: z.string().optional(),
  tts_api_key: z.string().optional(),
  tavily_api_key: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function placeholderFor(
  loading: boolean,
  fieldSet: boolean | undefined,
  masked: string | null | undefined,
  fallback: string
) {
  if (loading) return "Loading…";
  if (fieldSet && masked) return `Set (${masked}) – leave blank to keep`;
  return fallback;
}

function SavedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <Check className="w-3 h-3" /> Saved
    </span>
  );
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
    defaultValues: { hf_token: "", tts_api_key: "", tavily_api_key: "" },
  });

  useEffect(() => {
    if (open)
      form.reset({ hf_token: "", tts_api_key: "", tavily_api_key: "" });
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: (payload: FormValues) => {
      const body: Record<string, string> = {};
      for (const key of [
        "hf_token",
        "tts_api_key",
        "tavily_api_key",
      ] as const) {
        const val = (payload[key] || "").trim();
        if (val !== "") body[key] = val;
      }
      return updateSettings(body);
    },
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Secrets persist on the server. Changes apply immediately — no
            redeploy needed.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          autoComplete="off"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="hf_token">Hugging Face token</Label>
              {data?.hf_token.set && <SavedBadge />}
            </div>
            <Input
              id="hf_token"
              type="password"
              autoComplete="new-password"
              placeholder={placeholderFor(
                isLoading,
                data?.hf_token.set,
                data?.hf_token.masked,
                "hf_..."
              )}
              {...form.register("hf_token")}
            />
            <p className="text-xs text-stone-500">
              Used to download gated models.{" "}
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noreferrer"
                className="text-TT-purple inline-flex items-center gap-0.5 hover:underline"
              >
                Generate <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="tts_api_key">TTS API key</Label>
              {data?.tts_api_key.set && <SavedBadge />}
            </div>
            <Input
              id="tts_api_key"
              type="password"
              autoComplete="new-password"
              placeholder={placeholderFor(
                isLoading,
                data?.tts_api_key.set,
                data?.tts_api_key.masked,
                "Enter TTS API key"
              )}
              {...form.register("tts_api_key")}
            />
            <p className="text-xs text-stone-500">
              Authenticates TTS inference calls. Applied immediately.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="tavily_api_key">Tavily API key</Label>
              {data?.tavily_api_key.set && <SavedBadge />}
            </div>
            <Input
              id="tavily_api_key"
              type="password"
              autoComplete="new-password"
              placeholder={placeholderFor(
                isLoading,
                data?.tavily_api_key.set,
                data?.tavily_api_key.masked,
                "tvly-..."
              )}
              {...form.register("tavily_api_key")}
            />
            <p className="text-xs text-stone-500">
              Search-agent key. Picked up by running agents on next call.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" /> JWT secret
            </Label>
            <Input
              readOnly
              disabled
              value={
                isLoading ? "Loading…" : data?.jwt_secret.masked || "Auto-managed"
              }
            />
            <p className="text-xs text-stone-500">
              Auto-managed by the backend. Persisted across restarts.
            </p>
          </div>

          <div className="rounded-md border border-stone-200 dark:border-stone-800 p-3 space-y-2">
            <div className="flex items-center gap-1 text-sm font-medium">
              <Lock className="w-3.5 h-3.5" /> tt-inference artifact (read-only)
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-stone-500">Branch</div>
                <div className="font-mono truncate">
                  {data?.artifact.branch || "—"}
                </div>
              </div>
              <div>
                <div className="text-stone-500">Version</div>
                <div className="font-mono truncate">
                  {data?.artifact.version || "—"}
                </div>
              </div>
            </div>
            <p className="text-xs text-stone-500">
              {data?.artifact.description ||
                "Pins which tt-inference-server release TT Studio is built against."}
            </p>
          </div>

          <div className="pt-2">
            <HfAccessCheck />
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
