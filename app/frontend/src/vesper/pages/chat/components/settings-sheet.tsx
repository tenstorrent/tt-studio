// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ReactNode } from "react";
import { Slider } from "@tenstorrent/vesper/slider";
import { Switch } from "@tenstorrent/vesper/switch";
import { TextArea } from "@tenstorrent/vesper/text-area";
import { TextInput } from "@tenstorrent/vesper/text-input";
import { Typography } from "@tenstorrent/vesper/typography";
import { ControlledSheet } from "@/src/vesper/components/controlled-modal";
import { DEFAULT_SETTINGS, type ModelSettings } from "../use-chat";

function Field({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-vesper-3">
      <div className="flex items-center justify-between gap-vesper-3">
        <Typography
          as="span"
          variant="label-sm-bold"
          className="text-vesper-text-primary"
        >
          {label}
        </Typography>
        {value !== undefined && (
          <Typography
            as="span"
            variant="label-sm-mono"
            className="text-vesper-text-secondary"
          >
            {value}
          </Typography>
        )}
      </div>
      {children}
      {hint && (
        <Typography variant="copy-xs" className="text-vesper-text-tertiary">
          {hint}
        </Typography>
      )}
    </div>
  );
}

export function SettingsSheet({
  open,
  onOpenChange,
  settings,
  onChange,
  maxTokensLimit,
  supportsThinking,
  searchAgentAvailable,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  settings: ModelSettings;
  onChange(settings: ModelSettings): void;
  maxTokensLimit: number;
  supportsThinking: boolean;
  searchAgentAvailable: boolean;
}) {
  const set = <K extends keyof ModelSettings>(
    key: K,
    value: ModelSettings[K]
  ) => onChange({ ...settings, [key]: value });

  return (
    <ControlledSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Model parameters"
      description="Applied to every new message in this chat."
      buttons={[
        {
          children: "Reset to defaults",
          onClick: () =>
            onChange({
              ...DEFAULT_SETTINGS,
              maxTokens: Math.min(DEFAULT_SETTINGS.maxTokens, maxTokensLimit),
            }),
        },
        { children: "Done", onClick: () => onOpenChange(false) },
      ]}
    >
      <div className="flex flex-col gap-vesper-8 py-vesper-2">
        <Field
          label="System prompt"
          hint="Leave blank to use the default prompt, which describes the model and hardware."
        >
          <TextArea
            aria-label="System prompt"
            height={120}
            placeholder="You are a helpful assistant…"
            value={settings.systemPrompt}
            onChange={(e) => set("systemPrompt", e.target.value)}
          />
        </Field>
        <Field
          label="Temperature"
          value={settings.temperature.toFixed(1)}
          hint="Lower values are more focused, higher values more creative."
        >
          <Slider
            thumbAriaLabel="Temperature"
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature}
            onValueChange={(value) => set("temperature", value)}
          />
        </Field>
        <Field
          label="Maximum length"
          value={`${settings.maxTokens} tokens`}
          hint="The most tokens a reply can use."
        >
          <Slider
            thumbAriaLabel="Maximum length"
            min={1}
            max={maxTokensLimit}
            step={1}
            value={Math.min(settings.maxTokens, maxTokensLimit)}
            onValueChange={(value) => set("maxTokens", value)}
          />
        </Field>
        <Field
          label="Top P"
          value={settings.topP.toFixed(2)}
          hint="Nucleus sampling: only consider the most likely tokens up to this probability."
        >
          <Slider
            thumbAriaLabel="Top P"
            min={0}
            max={1}
            step={0.05}
            value={settings.topP}
            onValueChange={(value) => set("topP", value)}
          />
        </Field>
        <Field
          label="Top K"
          value={String(settings.topK)}
          hint="Only sample from this many of the most likely tokens."
        >
          <Slider
            thumbAriaLabel="Top K"
            min={1}
            max={100}
            step={1}
            value={settings.topK}
            onValueChange={(value) => set("topK", value)}
          />
        </Field>
        <Field
          label="Seed"
          hint="0 picks a random seed. Any other value makes replies reproducible."
        >
          <TextInput
            aria-label="Seed"
            type="number"
            min={0}
            value={String(settings.seed)}
            onChange={(e) =>
              set("seed", Math.max(0, Number(e.target.value) || 0))
            }
          />
        </Field>
        {supportsThinking && (
          <Switch
            label="Thinking"
            checked={settings.thinking}
            onChange={(e) => set("thinking", e.target.checked)}
          />
        )}
        {searchAgentAvailable && (
          <Switch
            label="Web search agent"
            checked={settings.searchAgent}
            onChange={(e) => set("searchAgent", e.target.checked)}
          />
        )}
      </div>
    </ControlledSheet>
  );
}
