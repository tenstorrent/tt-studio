// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { JSX } from "react";
import { X, ScrollText } from "lucide-react";
import { Button } from "../ui/button";
import { PulsatingDot } from "../ui/pulsating-dot";
import type { ModelRow } from "../../types/models";

interface ModelPreparingBannerProps {
  models: ModelRow[];
  onViewLogs: (id: string) => void;
  onDismiss: () => void;
}

export default function ModelPreparingBanner({
  models,
  onViewLogs,
  onDismiss,
}: ModelPreparingBannerProps): JSX.Element {
  const isSingle = models.length === 1;

  return (
    <div className="mx-6 mb-4 rounded-lg border border-amber-500/30 border-l-2 border-l-amber-500 bg-gradient-to-r from-amber-950/20 via-stone-900/40 to-transparent">
      <div className="flex items-start gap-4 p-4">
        {/* Left: status LED + text */}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="mt-0.5 shrink-0">
            <PulsatingDot label="Preparing models" color="amber" size="md" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-amber-400 text-sm font-semibold tracking-wider">
                LOADING
              </span>
              {isSingle && (
                <span className="font-mono text-stone-400 text-xs">
                  — {models[0].name}
                </span>
              )}
            </div>
            <p className="text-stone-300 text-sm">
              Initializing weights and warming up the inference cache.
              {isSingle
                ? " This may take a few minutes."
                : ` ${models.length} models are starting up.`}
            </p>
            {!isSingle && (
              <div className="flex flex-wrap gap-2 mt-2">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onViewLogs(m.id)}
                    className="font-mono text-xs text-stone-300 bg-stone-800/60 border border-stone-700/50 rounded px-2 py-0.5 hover:border-amber-500/50 hover:text-amber-400 transition-colors"
                  >
                    {m.name} ↗
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-stone-500 mt-1.5 italic">
              Open the <span className="text-stone-400 not-italic font-medium">Logs</span> tab →{" "}
              <span className="text-stone-400 not-italic font-medium">Events</span> for real-time startup progress.
            </p>
          </div>
        </div>

        {/* Right: View Logs + dismiss */}
        <div className="flex items-center gap-2 shrink-0">
          {isSingle && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onViewLogs(models[0].id)}
              className="border-amber-500/50 text-amber-400 hover:bg-amber-950/40 hover:border-amber-400 gap-1.5"
            >
              <ScrollText className="w-3.5 h-3.5" />
              View Logs
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={onDismiss}
            className="w-7 h-7 text-stone-500 hover:text-stone-300"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
