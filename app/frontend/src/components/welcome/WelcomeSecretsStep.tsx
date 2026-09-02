// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, ExternalLink, Eye, EyeOff } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import type { SettingsResponse } from "../../api/settingsApi";

export interface WelcomeSecrets {
  hf_token: string;
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-5 text-left"
    >
      <div>
        <h2 className="text-2xl font-semibold">Add your Hugging Face token</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          The token is stored on the server. Leave it blank to set it up later
          or to keep the existing value.
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
          Speeds up model weight downloads and unlocks gated models.{" "}
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

      {/* Without a token the inference server waits for credentials when a gated
          model is deployed, and the deploy sits at 0% with no explanation. Warn
          here, before the user hits that dead end. */}
      {!loading && !current?.hf_token.set && values.hf_token.trim() === "" && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
          <p className="text-xs text-yellow-800 dark:text-yellow-200">
            <span className="font-semibold">No token configured.</span> Deploys
            of gated models (Llama, Gemma, …) will stall at 0% while the server
            waits for Hugging Face credentials. Add a token above, or set{" "}
            <code className="font-mono">HF_TOKEN</code> in the{" "}
            <code className="font-mono">.env</code> file at the repo root and
            restart TT-Studio.
          </p>
        </div>
      )}

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
