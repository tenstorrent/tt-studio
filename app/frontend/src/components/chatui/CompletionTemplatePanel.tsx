// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useState } from "react";
import { Send, ChevronDown, ChevronRight, Sparkles, Info } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";

// Classic Alpaca instruction format. Fine-tuned models are typically trained on
// a fixed instruction template, so testing them means feeding inputs in that
// same shape and reading the completion the model produces after "### Response:".
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

/** Substitute {field} placeholders with the user's values. */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER_RE, (_, key) => values[key] ?? "");
}

/**
 * Derive stop sequences so completion generation halts at the next record
 * boundary instead of the model hallucinating a fresh example. Any markdown-
 * style header (e.g. "### Instruction:") that appears before the last
 * placeholder is a record delimiter; headers after it are the generation cue
 * (e.g. "### Response:") and must NOT be used as stops.
 */
export function deriveStops(template: string): string[] {
  const matches = [...template.matchAll(PLACEHOLDER_RE)];
  const last = matches[matches.length - 1];
  const cutoff = last ? (last.index ?? 0) + last[0].length : template.length;
  const before = template.slice(0, cutoff);
  const headers = before.match(/^\s*#{1,6}[^\n]*$/gm) ?? [];
  return [...new Set(headers.map((h) => h.trim()))];
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
  const [values, setValues] = useState<Record<string, string>>({});
  const [templateOpen, setTemplateOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const fields = useMemo(() => parseFields(template), [template]);
  const rendered = useMemo(
    () => renderTemplate(template, values),
    [template, values],
  );

  const canSend =
    !isStreaming &&
    fields.length > 0 &&
    fields.every((f) => (values[f] ?? "").trim() !== "");

  const handleSend = () => {
    if (!canSend) return;
    onSend(rendered, deriveStops(template));
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

      {/* Template editor (collapsed by default — most turns only touch fields) */}
      <div className="rounded-md border border-gray-200 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setTemplateOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300"
        >
          {templateOpen ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Prompt template
          <span className="ml-1 font-normal text-gray-400">
            {"use {placeholders} to create fields"}
          </span>
        </button>
        {templateOpen && (
          <div className="px-3 pb-3">
            <Textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={8}
              spellCheck={false}
              className="font-mono text-sm"
            />
          </div>
        )}
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
              {/* One line by default (min-h override drops the base 80px floor);
                  resize-y lets the user drag it taller when they need more room. */}
              <Textarea
                value={values[field] ?? ""}
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

      {/* Rendered-prompt preview — the exact string sent to /v1/completions, so
          the user can verify it matches the training format byte-for-byte. */}
      <div className="rounded-md border border-gray-200 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300"
        >
          {previewOpen ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Preview sent prompt
        </button>
        {previewOpen && (
          <pre className="px-3 pb-3 text-left whitespace-pre-wrap break-words font-mono text-sm text-gray-700 dark:text-gray-300">
            {rendered}
          </pre>
        )}
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
