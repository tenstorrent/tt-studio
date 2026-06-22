// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Zap, ZapOff } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { useHfXetStatus } from "../hooks/useHfXetStatus";

/**
 * Small pill shown alongside model-weight download progress indicating whether
 * HuggingFace's Xet CDN is in use. Neither state is universally better — Xet is
 * faster near an edge but slower on high-latency routes — so the styling is
 * neutral/informational, not good/bad. Renders nothing until the state is known.
 */
export default function HfXetBadge({ className = "" }: { className?: string }) {
  const xetEnabled = useHfXetStatus();
  if (xetEnabled === null) return null;

  const Icon = xetEnabled ? Zap : ZapOff;
  const label = xetEnabled ? "Xet on" : "Xet off";
  const color = xetEnabled
    ? "bg-violet-950/50 border-violet-700/50 text-violet-300"
    : "bg-stone-900/60 border-stone-700/60 text-stone-300";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ${color} ${className}`}
          >
            <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>
            HuggingFace Xet CDN is {xetEnabled ? "on" : "off"}. Xet uses
            deduplication and parallel chunks — faster near a Xet edge, slower on
            high-latency routes. Set <code>HF_HUB_DISABLE_XET=1</code> in{" "}
            <code>app/.env</code> to force the legacy HTTPS CDN.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
