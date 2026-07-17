// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from "react";
import { RotateCcw, Check } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import { SheetHeader, SheetTitle, SheetDescription } from "../ui/sheet";
import {
  DEFAULT_VOICE_SYSTEM_PROMPT,
  VOICE_PROMPT_PRESETS,
  VOICE_PROMPT_SAFETY_SUFFIX,
  VOICE_PROMPT_VARIABLES,
} from "./lib/prompts";

interface VoiceAgentSettingsProps {
  value: string;
  onSave: (prompt: string) => void;
}

// Editor body for the voice agent's system prompt, rendered inside a Sheet.
export function VoiceAgentSettings({ value, onSave }: VoiceAgentSettingsProps) {
  const [draft, setDraft] = useState(value);
  const [justSaved, setJustSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const justSavedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = draft !== value;
  const activePresetId = VOICE_PROMPT_PRESETS.find((p) => p.prompt === draft)?.id;
  const approxTokens = Math.ceil(draft.trim().length / 4);

  useEffect(() => {
    return () => {
      if (justSavedTimeoutRef.current) clearTimeout(justSavedTimeoutRef.current);
    };
  }, []);

  const handleSave = () => {
    onSave(draft);
    setJustSaved(true);
    if (justSavedTimeoutRef.current) clearTimeout(justSavedTimeoutRef.current);
    justSavedTimeoutRef.current = setTimeout(() => setJustSaved(false), 2000);
  };

  // Insert a variable placeholder at the cursor (or append if unfocused).
  const insertVariable = (variable: string) => {
    const el = textareaRef.current;
    if (!el) {
      setDraft((d) => `${d}${variable}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = draft.slice(0, start) + variable + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + variable.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="flex flex-col h-full">
      <SheetHeader>
        <SheetTitle className="font-['Bricolage_Grotesque']">Assistant Prompt</SheetTitle>
        <SheetDescription>
          Tune how the voice assistant behaves. Changes apply to the next turn and are saved in this browser.
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-1">
        {/* Presets */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Presets</label>
          <div className="flex flex-wrap gap-1.5">
            {VOICE_PROMPT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.description}
                onClick={() => setDraft(preset.prompt)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                  activePresetId === preset.id
                    ? "bg-TT-purple-accent text-white border-transparent"
                    : "bg-secondary text-secondary-foreground border-border hover:bg-secondary/70"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="voice-system-prompt" className="text-xs font-medium text-muted-foreground">
              System prompt
            </label>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {draft.trim().length} chars · ~{approxTokens} tokens
            </span>
          </div>
          <Textarea
            id="voice-system-prompt"
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-[220px] font-mono text-xs leading-relaxed resize-y"
            placeholder="Describe how the assistant should speak and behave…"
          />
        </div>

        {/* Template variables */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Insert variable</label>
          <div className="flex flex-wrap gap-1.5">
            {VOICE_PROMPT_VARIABLES.map((variable) => (
              <button
                key={variable}
                type="button"
                onClick={() => insertVariable(variable)}
                className="px-2 py-0.5 rounded-md text-[11px] font-mono border border-border bg-muted hover:bg-muted/60 transition-colors"
              >
                {variable}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Replaced per turn with the recognized user and deployed model name.
          </p>
        </div>

        {/* Locked safety suffix */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Always appended</label>
          <p className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground italic">
            {VOICE_PROMPT_SAFETY_SUFFIX}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDraft(DEFAULT_VOICE_SYSTEM_PROMPT)}
          disabled={draft === DEFAULT_VOICE_SYSTEM_PROMPT}
          className="text-xs"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
          Reset to default
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!dirty && !justSaved} className="text-xs">
          {justSaved ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Saved
            </>
          ) : (
            "Save prompt"
          )}
        </Button>
      </div>
    </div>
  );
}
