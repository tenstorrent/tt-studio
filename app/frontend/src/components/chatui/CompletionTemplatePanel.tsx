// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useState } from "react";
import { Send, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";
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
    <div className="p-2 sm:p-3 space-y-3 border-t border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-1.5 text-xs text-[#7C68FA]">
        <Sparkles className="w-3.5 h-3.5" />
        <span className="font-medium">Completion mode</span>
        <span className="text-gray-500 dark:text-gray-400">
          — fine-tuned model detected. Fill the template fields to test it in its
          training format.
        </span>
      </div>

      {/* Template editor (collapsed by default — most turns only touch fields) */}
      <div className="rounded-md border border-gray-200 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setTemplateOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300"
        >
          {templateOpen ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
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
              className="font-mono text-xs"
            />
          </div>
        )}
      </div>

      {/* Field inputs — one per placeholder */}
      {fields.length === 0 ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          {"Template has no {placeholders} — add at least one to enter values."}
        </p>
      ) : (
        <div className="space-y-2">
          {fields.map((field) => (
            <div key={field} className="space-y-1">
              <label className="text-xs font-medium capitalize text-gray-600 dark:text-gray-300">
                {field}
              </label>
              {field === "instruction" || field === "input" ? (
                <Textarea
                  value={values[field] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [field]: e.target.value }))
                  }
                  rows={field === "instruction" ? 3 : 2}
                  placeholder={`Enter ${field}…`}
                  className="text-sm"
                />
              ) : (
                <Input
                  value={values[field] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [field]: e.target.value }))
                  }
                  placeholder={`Enter ${field}…`}
                  className="text-sm"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {isStreaming && onStop ? (
          <Button variant="outline" size="sm" onClick={onStop}>
            Stop
          </Button>
        ) : null}
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!canSend}
          className={cn("gap-1.5")}
        >
          <Send className="w-3.5 h-3.5" />
          Run completion
        </Button>
      </div>
    </div>
  );
}
