// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cn } from "@/src/lib/utils";
import { getModelLogo } from "@/src/vesper/utils/models";

/** The brand logo of a model's publisher, or a generic model icon. */
export function ModelLogo({
  hfModelId,
  modelName,
  className,
}: {
  hfModelId?: string | null;
  modelName?: string;
  className?: string;
}) {
  const Logo = getModelLogo(hfModelId, modelName);
  return (
    <Logo
      aria-hidden
      className={cn("w-5 h-5 shrink-0 text-vesper-icon-primary", className)}
    />
  );
}
