// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useState } from "react";
import { Send, ChevronDown, ChevronRight, Sparkles, Info } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";

// Classic Alpaca instruction format — the fixed shape fine-tuned models are
// trained on, so testing means feeding inputs in this same shape.
const DEFAULT_TEMPLATE = `Below is an instruction that describes a task, paired with an input that provides further context. Write a response that appropriately completes the request.

### Instruction:
{instruction}

### Input:
{input}

### Response:
`;

const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** Unique placeholder names, in first-seen order. */
function parseFields(template: string): string[] {
  const seen: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

// Read a field as an own-property only: `\w+` also matches inherited members
// like `constructor`/`toString`, so a bare `values[key]` could return functions.
function ownValue(values: Record<string, string>, key: string): string {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : "";
}

/** Substitute {field} placeholders with the user's values. */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER_RE, (_, key) => ownValue(values, key));
}

// Parse stop-sequences input (one per line) into literal stop strings for vLLM;
// blank lines are dropped and each remaining line is trimmed.
export function parseStops(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface CompletionTemplatePanelProps {
  isStreaming: boolean;
  onSend: (prompt: string, stop: string[]) => void;
  onStop?: () => void;
}

export default function CompletionTemplatePanel({
  isStreaming,
  onSend,
  onStop,
}: CompletionTemplatePanelProps) {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  // Null-prototype map so placeholder names that collide with Object members
  // (e.g. {constructor}) don't resolve to inherited values.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.create(null),
  );
  const [stopText, setStopText] = useState("");
  // Editor and preview are two views of the same thing, so they share one
  // expand/collapse state.
  const [expanded, setExpanded] = useState(false);

  const fields = useMemo(() => parseFields(template), [template]);
  const rendered = useMemo(
    () => renderTemplate(template, values),
    [template, values],
  );
  const stops = useMemo(() => parseStops(stopText), [stopText]);

  // Block only when there's nothing to send: with placeholders require one
  // filled field; without them require some template text.
  const canSend =
    !isStreaming &&
    (fields.length > 0
      ? fields.some((f) => ownValue(values, f).trim() !== "")
      : template.trim() !== "");

  const handleSend = () => {
    if (!canSend) return;
    onSend(rendered, stops);
  };

  return (
    <div className="p-3 sm:p-4 space-y-4 border-t border-gray-200 dark:border-gray-800">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-sm text-[#7C68FA]">
          <Sparkles className="w-4 h-4" />
          <span className="font-medium">Template mode</span>
          <span className="text-gray-500 dark:text-gray-400">
            — fill the template fields to test the fine-tuned model in its
            training format.
          </span>
        </div>
        <div className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Each message is evaluated individually — no prior turns are sent as
            context.
          </span>
        </div>
        <div className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Temperature is set to 0 for deterministic output. You can change it
            in settings.
          </span>
        </div>
      </div>

      {/* Template editor + live preview side by side (stacked on mobile), both
          collapsed by default since most turns only touch the fields below. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-200 dark:border-gray-800 pt-4">
        <div className="rounded-md border border-gray-200 dark:border-gray-800">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="template-editor-region"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300"
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4 shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0" />
            )}
            Prompt template
            <span className="ml-1 font-normal text-gray-400 truncate">
              {"use {placeholders} to create fields"}
            </span>
          </button>
          {expanded && (
            <div id="template-editor-region" className="px-3 pb-3">
              <Textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={8}
                spellCheck={false}
                className="font-mono text-sm resize-y"
              />
            </div>
          )}
        </div>

        {/* Rendered-prompt preview — the exact string sent to /v1/completions,
            so the user can verify it matches the training format. */}
        <div className="rounded-md border border-gray-200 dark:border-gray-800">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="template-preview-region"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300"
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4 shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0" />
            )}
            Preview sent prompt
          </button>
          {expanded && (
            <pre
              id="template-preview-region"
              className="px-3 pb-3 max-h-50 overflow-auto text-left whitespace-pre-wrap break-words font-mono text-sm text-gray-700 dark:text-gray-300"
            >
              {rendered}
            </pre>
          )}
        </div>
      </div>

      {/* Field inputs — one per placeholder */}
      {fields.length === 0 ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          {"Template has no {placeholders} — add at least one to enter values."}
        </p>
      ) : (
        <div className="space-y-3">
          {fields.map((field) => (
            <div key={field} className="space-y-1.5">
              <label className="block text-left text-sm font-medium capitalize text-gray-700 dark:text-gray-200">
                {field}
              </label>
              {/* One line by default (min-h override drops the 80px floor);
                  resize-y lets the user drag it taller. */}
              <Textarea
                value={ownValue(values, field)}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [field]: e.target.value }))
                }
                rows={1}
                placeholder={`Enter ${field}…`}
                className="text-base min-h-0 resize-y"
              />
            </div>
          ))}
        </div>
      )}

      {/* Stop sequences — literal strings that halt generation, needed because a
          raw completion won't stop on its own unless the fine-tune emits EOS. */}
      <div className="space-y-1.5 border-t border-gray-200 dark:border-gray-800 pt-4">
        <label className="block text-left text-sm font-medium text-gray-700 dark:text-gray-200">
          Stop sequences{" "}
          <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <Textarea
          value={stopText}
          onChange={(e) => setStopText(e.target.value)}
          rows={1}
          spellCheck={false}
          placeholder={"One per line, e.g. ### Instruction:"}
          className="font-mono text-sm min-h-0 resize-y"
        />
        <p className="text-xs text-gray-400">
          Generation stops when the model outputs any of these. One per line.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        {isStreaming && onStop ? (
          <Button variant="outline" onClick={onStop}>
            Stop
          </Button>
        ) : null}
        <Button
          onClick={handleSend}
          disabled={!canSend}
          className={cn("gap-1.5")}
        >
          <Send className="w-4 h-4" />
          Run completion
        </Button>
      </div>
    </div>
  );
}
