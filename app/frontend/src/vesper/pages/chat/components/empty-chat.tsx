// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Globe } from "@tenstorrent/vesper/icons";
import { Typography } from "@tenstorrent/vesper/typography";

const SUGGESTIONS = [
  "Hello, how are you today?",
  "Can you tell me a joke?",
  "Write me a poem.",
  "Tell me a fun fact.",
];

export function EmptyChat({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick(prompt: string): void;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-auto flex flex-col items-center justify-center gap-vesper-12 p-vesper-6">
      <Typography
        as="h2"
        variant="heading-sm"
        className="text-vesper-text-primary"
      >
        Start a conversation
      </Typography>
      <ul className="w-full max-w-3xl grid grid-cols-1 sm:grid-cols-2 gap-vesper-6">
        {SUGGESTIONS.map((prompt) => (
          <li key={prompt}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(prompt)}
              className="w-full h-20 flex items-center gap-vesper-4 px-vesper-6 rounded-vesper-2 border border-vesper-border-secondary bg-vesper-background-secondary text-left transition-colors duration-vesper-fast hover:bg-vesper-tint-neutral-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:shadow-vesper-focus-ring"
            >
              <span className="w-8 h-8 shrink-0 flex items-center justify-center rounded-vesper-1 bg-vesper-background-accent-subtle">
                <Globe
                  className="w-5 h-5 text-vesper-icon-accent"
                  aria-hidden
                />
              </span>
              <Typography
                as="span"
                variant="copy-md"
                className="text-vesper-text-primary"
              >
                {prompt}
              </Typography>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
