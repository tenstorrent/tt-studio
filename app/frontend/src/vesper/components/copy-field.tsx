// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from "react";
import { Checkmark, Copy } from "@tenstorrent/vesper/icons";
import { TextInput } from "@tenstorrent/vesper/text-input";
import { addToast } from "@tenstorrent/vesper/toast";
import { cn } from "@/src/lib/utils";
import { copyToClipboard } from "@/src/utils/clipboard";

/** A read-only value (URL, token, id) with a copy-to-clipboard button. */
export function CopyField({
  value,
  label,
  className,
}: {
  value: string;
  /** Accessible name of the field, also used in the copy confirmation */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);

  return (
    <TextInput
      aria-label={label}
      readOnly
      value={value}
      className={cn(
        "w-full [&_input]:font-vesper-mono [&_input]:text-sm",
        className
      )}
      onFocus={(e) => e.currentTarget.select()}
      iconRight={copied ? <Checkmark /> : <Copy />}
      iconRightAction={{
        ariaLabel: `Copy ${label}`,
        handler: async () => {
          const error = await copyToClipboard(value);
          if (error) {
            addToast({ variant: "danger", content: `Couldn't copy: ${error}` });
            return;
          }
          setCopied(true);
          clearTimeout(timeout.current);
          timeout.current = setTimeout(() => setCopied(false), 2000);
        },
      }}
    />
  );
}
