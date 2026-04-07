// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { JSX } from "react";
import { X, Zap } from "lucide-react";
import { Button } from "../ui/button";
import type { ModelRow } from "../../types/models";
import { useEffect, useState } from "react";

interface ModelPreparingBannerProps {
  models: ModelRow[];
  onDismiss: () => void;
}

const WARMUP_STEPS = [
  "Loading weights into device memory",
  "Compiling inference graph",
  "Warming up KV cache",
  "Running preflight checks",
];

const STEP_DURATION_MS = 30_000; // 30s per step

/** Persists step index in sessionStorage so health-check re-mounts don't reset it */
function usePersistedStep(modelId: string): number {
  const storageKey = `warmup_step_${modelId}`;

  const [step, setStep] = useState<number>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const { step: saved, ts } = JSON.parse(raw) as { step: number; ts: number };
        const stepsElapsed = Math.floor((Date.now() - ts) / STEP_DURATION_MS);
        return Math.min(saved + stepsElapsed, WARMUP_STEPS.length - 1);
      }
    } catch {}
    return 0;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ step, ts: Date.now() }));
    } catch {}
  }, [step, storageKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => {
        const next = Math.min(s + 1, WARMUP_STEPS.length - 1);
        try {
          sessionStorage.setItem(storageKey, JSON.stringify({ step: next, ts: Date.now() }));
        } catch {}
        return next;
      });
    }, STEP_DURATION_MS);
    return () => clearInterval(interval);
  }, [storageKey]);

  return step;
}

function StepList({ modelId }: { modelId: string }) {
  const currentStep = usePersistedStep(modelId);

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1">
      {WARMUP_STEPS.map((label, i) => (
        <span
          key={label}
          className={`flex items-center gap-1.5 text-xs transition-colors duration-700 ${
            i < currentStep
              ? "text-stone-600"
              : i === currentStep
                ? "text-amber-300 font-medium"
                : "text-stone-500"
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 transition-colors duration-700 ${
              i < currentStep
                ? "bg-stone-700"
                : i === currentStep
                  ? "bg-amber-400 animate-pulse"
                  : "bg-stone-700/50"
            }`}
          />
          {label}
        </span>
      ))}
    </div>
  );
}

export default function ModelPreparingBanner({
  models,
  onDismiss,
}: ModelPreparingBannerProps): JSX.Element {
  const isSingle = models.length === 1;

  return (
    <div className="mx-6 mb-4 rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-950/25 via-stone-900/30 to-transparent overflow-hidden">
      {/* Thin amber top accent line */}
      <div className="h-px w-full bg-gradient-to-r from-amber-500/60 via-amber-400/30 to-transparent" />

      <div className="flex items-start gap-4 px-4 pt-3 pb-4">
        {/* Left: content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span className="font-mono text-amber-400 text-xs font-semibold tracking-widest uppercase">
              Warming Up
            </span>
            {isSingle && (
              <span className="text-stone-400 text-xs truncate">
                — {models[0].name}
              </span>
            )}
          </div>

          {/* Indeterminate progress bar */}
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-stone-800/80 mb-3">
            <div className="absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-amber-400/80 to-transparent animate-warmup-slide" />
          </div>

          {/* All steps listed — current one highlighted, future ones dimmed */}
          {isSingle ? (
            <StepList modelId={models[0].id} />
          ) : (
            <div className="flex flex-col gap-2">
              {models.map((m) => (
                <div key={m.id}>
                  <span className="text-stone-500 text-xs">{m.name}</span>
                  <StepList modelId={m.id} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: dismiss */}
        <Button
          size="icon"
          variant="ghost"
          onClick={onDismiss}
          className="w-7 h-7 shrink-0 mt-0.5 text-stone-600 hover:text-stone-400"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
