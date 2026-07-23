// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import type { UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ExternalLink, Eye, EyeOff, Lock } from "lucide-react";

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
  type SettingField,
  type SettingsResponse,
  type UpdateSettingsResponse,
} from "../api/settingsApi";

const formSchema = z.object({
  hf_token: z.string().optional(),
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

/**
 * Distinguishes where a secret's current value comes from so an inherited
 * `.env` fallback doesn't look identical to a value saved through the UI.
 */
function SourceBadge({ field }: { field?: SettingField }) {
  if (!field?.set) {
    return (
      <span className="inline-flex items-center rounded-full bg-stone-500/10 px-2 py-0.5 text-xs font-medium text-stone-500">
        Not set
      </span>
    );
  }
  if (field.source === "env") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        From .env (fallback)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      <Check className="w-3 h-3" /> Saved via UI
    </span>
  );
}

/** Password input with a reveal toggle. Values are pre-filled from the
 * server, so the eye shows the actual stored secret. */
function SecretField({
  id,
  label,
  field,
  loading,
  placeholder,
  register,
  children,
}: {
  id: string;
  label: string;
  field?: SettingField;
  loading: boolean;
  placeholder: string;
  register: UseFormRegisterReturn;
  children?: ReactNode;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        <SourceBadge field={field} />
      </div>
      <div className="relative">
        <Input
          id={id}
          type={reveal ? "text" : "password"}
          autoComplete="new-password"
          className="pr-10"
          placeholder={placeholderFor(loading, field?.set, field?.masked, placeholder)}
          {...register}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setReveal((r) => !r)}
          aria-label={reveal ? "Hide value" : "Show value"}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
        >
          {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {children}
    </div>
  );
}

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [showHfCheck, setShowHfCheck] = useState(false);

  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: getSettings,
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { hf_token: "", tavily_api_key: "" },
  });

  const hfTokenValue = (form.watch("hf_token") || "").trim();

  // Pre-fill the form with the stored plaintext values so they are visible
  // behind the reveal toggle and editable in place.
  useEffect(() => {
    if (open) {
      form.reset({
        hf_token: data?.hf_token.value ?? "",
        tavily_api_key: data?.tavily_api_key.value ?? "",
      });
      setShowHfCheck(false);
    }
  }, [open, data, form]);

  const mutation = useMutation({
    mutationFn: (payload: FormValues): Promise<UpdateSettingsResponse> => {
      // Only send fields the user actually changed; an untouched pre-filled
      // value is not an update (re-sending the HF token would spuriously
      // flag a redeploy). Blank still means "keep the existing value".
      const body: Record<string, string> = {};
      for (const key of [
        "hf_token",
        "tavily_api_key",
      ] as const) {
        const val = (payload[key] || "").trim();
        if (val !== "" && val !== (data?.[key].value ?? "")) body[key] = val;
      }
      // Nothing entered — resolve as a no-op instead of POSTing an empty body
      // (which the backend now also tolerates) so a blank Save isn't an error.
      if (Object.keys(body).length === 0) {
        return Promise.resolve({ ok: true, requires_redeploy: false, updated: [] });
      }
      return updateSettings(body);
    },
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (!resp.updated.length) {
        customToast.info("No changes to save.");
      } else if (resp.requires_redeploy) {
        customToast.success(
          "Settings saved. Redeploy any running model to pick up the new Hugging Face token."
        );
      } else {
        customToast.success("Settings saved.");
      }
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
            Secrets persist on the server. Most changes apply on the next request;
            the Hugging Face token only affects newly deployed models.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          autoComplete="off"
        >
          <SecretField
            id="hf_token"
            label="Hugging Face token"
            field={data?.hf_token}
            loading={isLoading}
            placeholder="hf_..."
            register={form.register("hf_token")}
          >
            <p className="text-xs text-stone-500">
              Downloads gated weights for both LLM and media (image/video/voice)
              models. Affects new deployments — redeploy a running model to apply
              a changed token.{" "}
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noreferrer"
                className="text-TT-purple inline-flex items-center gap-0.5 hover:underline"
              >
                Generate <ExternalLink className="w-3 h-3" />
              </a>
            </p>

            <div className="rounded-md border border-stone-200 dark:border-stone-800">
              <button
                type="button"
                onClick={() => setShowHfCheck((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
              >
                Check Hugging Face access
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    showHfCheck ? "rotate-180" : ""
                  }`}
                />
              </button>
              {showHfCheck && (
                <div className="border-t border-stone-200 dark:border-stone-800 p-3">
                  <p className="mb-3 text-xs text-stone-500">
                    Tests the token typed above (or the saved token if the field
                    is blank).
                  </p>
                  <HfAccessCheck token={hfTokenValue || undefined} />
                </div>
              )}
            </div>
          </SecretField>

          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" /> TTS API key
            </Label>
            <Input
              readOnly
              disabled
              value={
                isLoading ? "Loading…" : data?.tts_api_key.masked || "Auto-managed"
              }
            />
            <p className="text-xs text-stone-500">
              Auto-managed for media / voice (TTS &amp; STT) auth. Matches the
              media inference server's default; to use a custom key, set{" "}
              <code className="rounded bg-stone-100 dark:bg-stone-800 px-1 py-0.5 font-mono">
                TTS_API_KEY
              </code>{" "}
              in the root .env and redeploy.
            </p>
          </div>

          <SecretField
            id="tavily_api_key"
            label="Tavily API key"
            field={data?.tavily_api_key}
            loading={isLoading}
            placeholder="tvly-..."
            register={form.register("tavily_api_key")}
          >
            <p className="text-xs text-stone-500">
              Powers the web-search agent. Picked up by running agents on their
              next search.
            </p>
          </SecretField>

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
              Auto-managed by the backend for LLM serving auth. Persisted across
              restarts.
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
                "Pins which tt-inference-server release TT Studio is built against."}{" "}
              To change it, run{" "}
              <code className="rounded bg-stone-100 dark:bg-stone-800 px-1 py-0.5 font-mono">
                python run.py --reconfigure-inference-server
              </code>{" "}
              and redeploy.
            </p>
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
