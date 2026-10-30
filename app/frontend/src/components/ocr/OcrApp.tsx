// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/*
 * Read text off photos.
 *
 * Drop one or more images, get the text back. Images are read one at a time,
 * so progress, retry and cancel are all per-image; see useOcrRun for why.
 *
 * The deployed-model list comes from useModels() rather than a fetch of its
 * own, which means this page issues no request on mount and renders correctly
 * when nothing is deployed.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, ScanText } from "lucide-react";

import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { fetchModelHealth, isOcrCapableModel } from "../../api/modelsDeployedApis";
import { useModels } from "../../hooks/useModels";
import type { HealthStatus } from "../../types/models";
import { OcrDropzone } from "./OcrDropzone";
import { OcrResultCard } from "./OcrResultCard";
import { OcrResultsToolbar } from "./OcrResultsToolbar";
import { isPendingStatus, useOcrRun } from "./useOcrRun";
import { OCR_MAX_IMAGES } from "./lib/ocrClient";

/** Radix rejects an empty SelectItem value, so the remote option needs a name. */
const CLOUD_OPTION = "__cloud__";

/** The instruction the server sends with every image; shown, not editable. */
const OCR_PROMPT_LABEL = "OCR:";

const HEALTH_POLL_MS = 10_000;

export default function OcrApp() {
  const location = useLocation();
  const { models } = useModels();
  const run = useOcrRun();

  const [selected, setSelected] = useState<string>(CLOUD_OPTION);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const didPreselect = useRef(false);

  const ocrModels = useMemo(
    () =>
      models.filter(
        (model) =>
          // model_impl reports "vlm" while the catalog stores "VLM".
          (model.model_type ?? "").toLowerCase() === "vlm" &&
          isOcrCapableModel(model.name, model.image),
      ),
    [models],
  );

  // Preselect: whatever Models Deployed sent us, else the first OCR model.
  // Landing on /ocr directly is legitimate, so a missing location state is not
  // an error worth a toast.
  useEffect(() => {
    if (didPreselect.current || !ocrModels.length) return;
    const fromNav = (location.state as { containerID?: string } | null)
      ?.containerID;
    const match = fromNav && ocrModels.find((m) => m.id === fromNav);
    setSelected(match ? match.id : ocrModels[0].id);
    didPreselect.current = true;
  }, [location.state, ocrModels]);

  const deployId = selected === CLOUD_OPTION ? null : selected;

  // Probe the chosen deployment, and keep probing while it is warming up.
  useEffect(() => {
    if (!deployId) {
      setHealth(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;

    const probe = async () => {
      const status = await fetchModelHealth(deployId);
      if (cancelled) return;
      setHealth(status);
      if (status !== "healthy") {
        timer = window.setTimeout(probe, HEALTH_POLL_MS);
      }
    };
    probe();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [deployId]);

  const isRunning = run.runStatus === "running";
  const queuedCount = run.items.filter((item) =>
    isPendingStatus(item.status),
  ).length;
  const isWarming = health === "starting";
  const canStart = !isRunning && queuedCount > 0 && !isWarming;

  return (
    <div className="w-full h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-8 flex flex-col gap-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ScanText className="w-7 h-7" />
            Read Text from Images
          </h1>
          <p className="mt-2 text-base text-gray-600 dark:text-gray-300">
            Drop in a photo, a screenshot or a scanned page and get its text
            back. Images are read one at a time.
          </p>
        </motion.div>

        {run.partialRun && !run.restoredText && (
          <div className="rounded-lg border-2 border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              An earlier run was interrupted after{" "}
              {run.partialRun.sourceNames.length}{" "}
              {run.partialRun.sourceNames.length === 1 ? "page" : "pages"}. Its
              text was kept.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={run.restorePartialRun}>
                Show it
              </Button>
              <Button variant="ghost" size="sm" onClick={run.dismissPartialRun}>
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {run.restoredText && (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
                Recovered from an interrupted run
              </p>
              <Button variant="ghost" size="sm" onClick={run.dismissPartialRun}>
                Dismiss
              </Button>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-neutral-800 dark:text-neutral-200">
              {run.restoredText}
            </pre>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            OCR Model
          </label>
          {ocrModels.length === 0 ? (
            <div className="text-sm text-amber-600 dark:text-amber-400 border-2 border-amber-400 dark:border-amber-600 rounded-lg px-4 py-3 bg-amber-50 dark:bg-amber-950">
              No OCR model is deployed.{" "}
              <a href="/models-deployed" className="underline font-medium">
                Deploy one
              </a>{" "}
              to read images on this machine, or use a remote endpoint below.
            </div>
          ) : null}

          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-12 text-base border-2">
              <SelectValue placeholder="Select an OCR model" />
            </SelectTrigger>
            <SelectContent>
              {ocrModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
              <SelectItem value={CLOUD_OPTION}>
                Remote endpoint (CLOUD_OCR_URL)
              </SelectItem>
            </SelectContent>
          </Select>

          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Prompt sent with every image:{" "}
            <code className="font-mono">{OCR_PROMPT_LABEL}</code>
          </p>

          {isWarming && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Model is still starting. This usually takes a few minutes on first
              deploy.
            </p>
          )}
          {(health === "unavailable" || health === "unknown") && (
            <p className="text-sm text-red-600 dark:text-red-400">
              Model is not answering health checks. Reading may fail.
            </p>
          )}
        </div>

        <OcrDropzone
          onFiles={run.addFiles}
          disabled={isRunning}
          remainingSlots={Math.max(0, OCR_MAX_IMAGES - run.items.length)}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => run.start(deployId)}
            disabled={!canStart}
            className="min-w-36"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Reading{" "}
                {run.runningPosition
                  ? `${run.runningPosition} of ${run.items.length}`
                  : ""}
              </>
            ) : (
              <>
                <ScanText className="w-4 h-4 mr-2" />
                Read text
              </>
            )}
          </Button>

          {isRunning && (
            <Button variant="outline" onClick={run.cancel}>
              Cancel
            </Button>
          )}

          {!isRunning && queuedCount > 0 && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {queuedCount} {queuedCount === 1 ? "image" : "images"} ready
            </p>
          )}
        </div>

        {run.runBanner && (
          <div className="rounded-lg border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            {run.runBanner}
          </div>
        )}

        {run.items.length > 0 && (
          <div className="flex flex-col gap-3">
            {run.items.map((item, index) => (
              <OcrResultCard
                key={item.id}
                item={item}
                index={index}
                disabled={isRunning}
                showRaw={showRaw}
                onRetry={(id) => run.retry(id, deployId)}
                onRemove={run.removeItem}
              />
            ))}
          </div>
        )}

        {run.allText && (
          <OcrResultsToolbar
            text={run.allText}
            pageCount={run.doneCount}
            showRaw={showRaw}
            onToggleRaw={() => setShowRaw((prev) => !prev)}
            onClear={run.clearAll}
            clearDisabled={isRunning}
          />
        )}
      </div>
    </div>
  );
}
