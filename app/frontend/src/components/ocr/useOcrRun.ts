// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/*
 * Run state for the OCR page: a queue of images read one at a time.
 *
 * The components that consume this are deliberately dumb -- every decision
 * about what happens to a page on failure, and which pages are kept, lives
 * here so there is one place to read it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { customToast } from "../CustomToaster";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/src/lib/storage";
import {
  OCR_MAX_FILE_BYTES,
  OCR_MAX_IMAGES,
  OCR_PAGE_SEPARATOR,
  requestOcr,
  type OcrPageResult,
  type OcrRequestResult,
} from "./lib/ocrClient";

export type OcrItemStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface OcrItem {
  id: string;
  file: File;
  previewUrl: string;
  status: OcrItemStatus;
  text?: string;
  error?: string;
  finishReason?: string | null;
  usage?: Record<string, number> | null;
  elapsedMs?: number;
}

export type RunStatus = "idle" | "running" | "done" | "cancelled";

export interface PartialRun {
  savedAt: number;
  text: string;
  sourceNames: string[];
}

const PARTIAL_RUN_KEY = "ocr:partial-run:v1";

const MB = 1024 * 1024;

/**
 * Turn one response into the item fields it implies.
 *
 * Ordered so the server's own explanation always wins over the status code: an
 * image the server cannot decode returns 200 with pages[0].error and no text,
 * while a model that fell over returns a top-level error and no pages at all.
 * Both need to reach the card, and they say different things to the user.
 */
function applyResult(result: OcrRequestResult): Partial<OcrItem> {
  const page: OcrPageResult | undefined =
    result.pages.find((p) => p.index === 0) ?? result.pages[0];

  if (page && page.text != null) {
    return {
      status: "done",
      text: page.text,
      finishReason: page.finish_reason ?? null,
      usage: page.usage ?? null,
      error: undefined,
    };
  }
  if (page && page.error) {
    return { status: "failed", error: page.error };
  }
  if (result.error) {
    return { status: "failed", error: result.error };
  }
  return {
    status: "failed",
    error: "The OCR service returned an unreadable response.",
  };
}

/**
 * An endpoint-level failure, as opposed to one bad file.
 *
 * 5xx and a dead connection say the deployment itself is unwell, so the rest of
 * the queue would only burn the per-image timeout again; a 4xx or a per-page
 * error says nothing about the next image.
 */
function isEndpointFailure(result: OcrRequestResult): boolean {
  if (result.ok || result.aborted) return false;
  return result.status === 0 || result.status >= 500;
}

function dedupeKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function joinDone(items: OcrItem[]): string {
  return items
    .filter((item) => item.status === "done" && item.text)
    .map((item) => item.text as string)
    .join(OCR_PAGE_SEPARATOR);
}

export function useOcrRun() {
  const [items, setItems] = useState<OcrItem[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [runBanner, setRunBanner] = useState<string | null>(null);
  const [partialRun, setPartialRun] = useState<PartialRun | null>(() =>
    safeGetItem<PartialRun | null>(PARTIAL_RUN_KEY, null),
  );
  const [restoredText, setRestoredText] = useState<string | null>(null);

  // Mirror of items, so the sequential loop never reads a stale closure.
  const itemsRef = useRef<OcrItem[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped per run, so a superseded run's late response is ignored.
  const runIdRef = useRef(0);
  const idCounter = useRef(0);
  const urlsRef = useRef(new Map<string, string>());

  const commit = useCallback(
    (next: OcrItem[] | ((prev: OcrItem[]) => OcrItem[])) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: OcrItem[]) => OcrItem[])(itemsRef.current)
          : next;
      itemsRef.current = resolved;
      setItems(resolved);
      return resolved;
    },
    [],
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<OcrItem>) =>
      commit((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      ),
    [commit],
  );

  const revoke = useCallback((id: string) => {
    const url = urlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(id);
    }
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.clear();
    },
    [],
  );

  /**
   * Validate and queue dropped files.
   *
   * Neither shared dropzone surfaces a rejection (both only console.warn), so
   * saying why a file was refused is the caller's job.
   */
  const addFiles = useCallback(
    (incoming: File[]) => {
      if (!incoming.length) return;

      const rejectedType: string[] = [];
      const rejectedSize: string[] = [];
      const rejectedEmpty: string[] = [];
      const seen = new Set(itemsRef.current.map((item) => dedupeKey(item.file)));
      const accepted: File[] = [];

      incoming.forEach((file) => {
        if (!file.type.startsWith("image/")) {
          rejectedType.push(file.name);
        } else if (file.size === 0) {
          rejectedEmpty.push(file.name);
        } else if (file.size > OCR_MAX_FILE_BYTES) {
          rejectedSize.push(
            `${file.name} (${(file.size / MB).toFixed(1)} MB)`,
          );
        } else if (!seen.has(dedupeKey(file))) {
          seen.add(dedupeKey(file));
          accepted.push(file);
        }
      });

      const summarise = (names: string[]) =>
        names.slice(0, 3).join(", ") +
        (names.length > 3 ? ` and ${names.length - 3} more` : "");

      if (rejectedType.length) {
        customToast.error(
          `Not an image: ${summarise(rejectedType)}. Photos and screenshots only.`,
        );
      }
      if (rejectedEmpty.length) {
        customToast.error(`Empty file: ${summarise(rejectedEmpty)}.`);
      }
      if (rejectedSize.length) {
        customToast.error(
          `Too large, ${OCR_MAX_FILE_BYTES / MB} MB max: ${summarise(rejectedSize)}.`,
        );
      }

      const remaining = OCR_MAX_IMAGES - itemsRef.current.length;
      if (remaining <= 0) {
        if (accepted.length) {
          customToast.error(
            `Already at the ${OCR_MAX_IMAGES} image limit for one run.`,
          );
        }
        return;
      }

      const kept = accepted.slice(0, remaining);
      if (accepted.length > kept.length) {
        customToast.error(
          `Only ${OCR_MAX_IMAGES} images per run, so the first ${kept.length} were kept.`,
        );
      }
      if (!kept.length) return;

      const created = kept.map((file) => {
        idCounter.current += 1;
        const id = `ocr-${Date.now()}-${idCounter.current}`;
        const previewUrl = URL.createObjectURL(file);
        urlsRef.current.set(id, previewUrl);
        return { id, file, previewUrl, status: "queued" as OcrItemStatus };
      });

      commit((prev) => [...prev, ...created]);
      setRunBanner(null);
      if (runStatus !== "running") setRunStatus("idle");
    },
    [commit, runStatus],
  );

  const removeItem = useCallback(
    (id: string) => {
      const target = itemsRef.current.find((item) => item.id === id);
      if (!target || target.status === "running") return;
      revoke(id);
      commit((prev) => prev.filter((item) => item.id !== id));
    },
    [commit, revoke],
  );

  const clearAll = useCallback(() => {
    abortRef.current?.abort();
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current.clear();
    commit([]);
    setRunStatus("idle");
    setRunBanner(null);
    setRestoredText(null);
    setPartialRun(null);
    safeRemoveItem(PARTIAL_RUN_KEY);
  }, [commit]);

  /** Record finished pages, so an interrupted run is recoverable on reload. */
  const persistProgress = useCallback(() => {
    const done = itemsRef.current.filter((item) => item.status === "done");
    if (!done.length) return;
    safeSetItem<PartialRun>(PARTIAL_RUN_KEY, {
      savedAt: Date.now(),
      text: joinDone(itemsRef.current),
      sourceNames: done.map((item) => item.file.name),
    });
  }, []);

  /** Read one image. Returns the result so the caller can decide to continue. */
  const runOne = useCallback(
    async (
      id: string,
      deployId: string | null,
      runId: number,
    ): Promise<OcrRequestResult | null> => {
      const target = itemsRef.current.find((item) => item.id === id);
      if (!target) return null;

      updateItem(id, { status: "running", error: undefined });
      const startedAt = Date.now();
      const result = await requestOcr([target.file], {
        deployId,
        signal: abortRef.current?.signal,
      });

      if (runId !== runIdRef.current) return result;

      if (result.aborted) {
        updateItem(id, { status: "cancelled", elapsedMs: Date.now() - startedAt });
        return result;
      }

      updateItem(id, {
        ...applyResult(result),
        elapsedMs: Date.now() - startedAt,
      });
      persistProgress();
      return result;
    },
    [persistProgress, updateItem],
  );

  const start = useCallback(
    async (deployId: string | null) => {
      const queued = itemsRef.current
        .filter((item) => item.status === "queued" || item.status === "cancelled")
        .map((item) => item.id);
      if (!queued.length) return;

      runIdRef.current += 1;
      const runId = runIdRef.current;
      abortRef.current = new AbortController();
      setRunBanner(null);
      setRunStatus("running");

      let stopped = false;
      for (let i = 0; i < queued.length; i += 1) {
        const result = await runOne(queued[i], deployId, runId);
        if (runId !== runIdRef.current) return;
        if (!result) continue;

        if (result.aborted) {
          stopped = true;
          break;
        }
        if (isEndpointFailure(result)) {
          const kept = itemsRef.current.filter(
            (item) => item.status === "done",
          ).length;
          setRunBanner(
            `Stopped after image ${i + 1} of ${queued.length}: ${result.error}. ` +
              `${kept} ${kept === 1 ? "page" : "pages"} kept.`,
          );
          commit((prev) =>
            prev.map((item) =>
              item.status === "queued" ? { ...item, status: "cancelled" } : item,
            ),
          );
          stopped = true;
          break;
        }
      }

      if (runId !== runIdRef.current) return;

      if (stopped) {
        setRunStatus("cancelled");
      } else {
        setRunStatus("done");
        // A run that finished on its own needs no recovery record.
        safeRemoveItem(PARTIAL_RUN_KEY);
      }
      abortRef.current = null;
    },
    [commit, runOne],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    const kept = itemsRef.current.filter((i) => i.status === "done").length;
    commit((prev) =>
      prev.map((item) =>
        item.status === "queued" ? { ...item, status: "cancelled" } : item,
      ),
    );
    setRunBanner(
      kept
        ? `Cancelled. ${kept} ${kept === 1 ? "page" : "pages"} kept.`
        : "Cancelled.",
    );
  }, [commit]);

  const retry = useCallback(
    async (id: string, deployId: string | null) => {
      if (runStatus === "running") return;
      runIdRef.current += 1;
      const runId = runIdRef.current;
      abortRef.current = new AbortController();
      setRunBanner(null);
      setRunStatus("running");
      await runOne(id, deployId, runId);
      if (runId !== runIdRef.current) return;
      setRunStatus("done");
      abortRef.current = null;
    },
    [runOne, runStatus],
  );

  const restorePartialRun = useCallback(() => {
    if (!partialRun) return;
    setRestoredText(partialRun.text);
  }, [partialRun]);

  const dismissPartialRun = useCallback(() => {
    setPartialRun(null);
    setRestoredText(null);
    safeRemoveItem(PARTIAL_RUN_KEY);
  }, []);

  const doneCount = items.filter((item) => item.status === "done").length;
  const runningIndex = items.findIndex((item) => item.status === "running");

  return {
    items,
    runStatus,
    runBanner,
    doneCount,
    runningId: runningIndex >= 0 ? items[runningIndex].id : null,
    runningPosition: runningIndex >= 0 ? runningIndex + 1 : null,
    allText: joinDone(items),
    partialRun,
    restoredText,
    addFiles,
    removeItem,
    clearAll,
    start,
    cancel,
    retry,
    restorePartialRun,
    dismissPartialRun,
  };
}

export type UseOcrRun = ReturnType<typeof useOcrRun>;
