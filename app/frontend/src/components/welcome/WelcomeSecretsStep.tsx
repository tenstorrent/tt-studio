// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ExternalLink, Eye, EyeOff, Lock } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import type { SettingsResponse } from "../../api/settingsApi";

export interface WelcomeSecrets {
  hf_token: string;
  tts_api_key: string;
  tavily_api_key: string;
}

interface Props {
  current?: SettingsResponse;
  values: WelcomeSecrets;
  onChange: (next: WelcomeSecrets) => void;
  onBack: () => void;
  onNext: () => void;
  isSaving: boolean;
}

function fieldPlaceholder(
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

/** Controlled password input with a reveal toggle. Values are pre-filled from
 * the server, so the eye shows the actual stored secret. */
function RevealInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={reveal ? "text" : "password"}
        autoComplete="new-password"
        className="pr-10"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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
  );
}

export default function WelcomeSecretsStep({
  current,
  values,
  onChange,
  onBack,
  onNext,
  isSaving,
}: Props) {
  const loading = !current;
  const jwtMasked = current?.jwt_secret.masked;
  const artifact = current?.artifact;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      <div>
        <h2 className="text-2xl font-semibold">Set your secrets</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          All values persist on the server. Leave a field blank to skip it for
          now or keep the existing value.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="hf_token">Hugging Face token</Label>
          {current?.hf_token.set && <SavedBadge />}
        </div>
        <RevealInput
          id="hf_token"
          value={values.hf_token}
          onChange={(v) => onChange({ ...values, hf_token: v })}
          placeholder={fieldPlaceholder(
            loading,
            current?.hf_token.set,
            current?.hf_token.masked,
            "hf_..."
          )}
        />
        <p className="text-xs text-stone-500">
          Required to download gated models.{" "}
          <a
            href="https://huggingface.co/settings/tokens"
            target="_blank"
            rel="noreferrer"
            className="text-TT-purple inline-flex items-center gap-0.5 hover:underline"
          >
            Generate a token <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="tts_api_key">TTS API key</Label>
          {current?.tts_api_key.set && <SavedBadge />}
        </div>
        <RevealInput
          id="tts_api_key"
          value={values.tts_api_key}
          onChange={(v) => onChange({ ...values, tts_api_key: v })}
          placeholder={fieldPlaceholder(
            loading,
            current?.tts_api_key.set,
            current?.tts_api_key.masked,
            "Enter TTS API key"
          )}
        />
        <p className="text-xs text-stone-500">
          Authenticates calls to the TTS inference server.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="tavily_api_key">Tavily API key</Label>
          {current?.tavily_api_key.set && <SavedBadge />}
        </div>
        <RevealInput
          id="tavily_api_key"
          value={values.tavily_api_key}
          onChange={(v) => onChange({ ...values, tavily_api_key: v })}
          placeholder={fieldPlaceholder(
            loading,
            current?.tavily_api_key.set,
            current?.tavily_api_key.masked,
            "tvly-..."
          )}
        />
        <p className="text-xs text-stone-500">
          Optional. Used by the search agent.{" "}
          <a
            href="https://tavily.com"
            target="_blank"
            rel="noreferrer"
            className="text-TT-purple inline-flex items-center gap-0.5 hover:underline"
          >
            tavily.com <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1">
          <Lock className="w-3.5 h-3.5" /> JWT secret
        </Label>
        <Input readOnly disabled value={jwtMasked || "Auto-managed"} />
        <p className="text-xs text-stone-500">
          Auto-generated and stored for you.
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
              {artifact?.branch || "—"}
            </div>
          </div>
          <div>
            <div className="text-stone-500">Version</div>
            <div className="font-mono truncate">
              {artifact?.version || "—"}
            </div>
          </div>
        </div>
        <p className="text-xs text-stone-500">
          {artifact?.description ||
            "Pins which tt-inference-server release TT Studio is built against."}
        </p>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack} disabled={isSaving}>
          Back
        </Button>
        <Button onClick={onNext} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </motion.div>
  );
}
