// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Progress } from "../ui/progress";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { DatasetUploadField } from "./DatasetUploadField";
import { DatasetPreview } from "./DatasetPreview";
import {
  parseDatasetFile,
  DatasetParseError,
  type DatasetPreview as DatasetPreviewData,
} from "./datasetPreview";
import {
  deleteCustomDataset,
  fetchCustomDatasetContent,
  fetchCustomDatasets,
  uploadCustomDataset,
  formatTrainingTimestamp,
  type CustomDataset,
} from "../../api/trainingApi";
import { customToast } from "../CustomToaster";

// Guard against reading arbitrarily large files into memory for a client-side
// preview. 25 MB is generous for a JSON dataset sample.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

type Phase = "idle" | "reading" | "parsing" | "ready" | "error";

// What the current preview is showing: a freshly selected local file (which can
// still be uploaded) or a dataset already stored on the server (already saved,
// so the "Save for Training" action is disallowed).
type PreviewSource = "file" | "existing";

interface DatasetPreviewPanelProps {
  // Notified after a dataset is successfully uploaded to the server so parents
  // (e.g. the training dialog) can refresh their custom-dataset list.
  onUploaded?: () => void;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DatasetPreviewPanel({ onUploaded }: DatasetPreviewPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DatasetPreviewData | null>(null);
  const [previewSource, setPreviewSource] = useState<PreviewSource | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const readerRef = useRef<FileReader | null>(null);

  // Previously uploaded datasets discovered on the shared training volume.
  const [datasets, setDatasets] = useState<CustomDataset[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refreshDatasets = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const list = await fetchCustomDatasets();
      setDatasets(list);
    } catch {
      setListError("Failed to load uploaded datasets.");
    } finally {
      setListLoading(false);
    }
  }, []);

  // Search the custom_datasets directory whenever the panel mounts so returning
  // to the training tab always reflects what has already been uploaded.
  useEffect(() => {
    void refreshDatasets();
  }, [refreshDatasets]);

  const reset = useCallback(() => {
    readerRef.current?.abort();
    readerRef.current = null;
    setFile(null);
    setPhase("idle");
    setProgress(0);
    setError(null);
    setPreview(null);
    setPreviewSource(null);
    setPreviewName(null);
    setUploading(false);
    setUploaded(false);
    setSelectedId(null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadCustomDataset(file);
      setUploaded(true);
      customToast.success(`Uploaded "${file.name}" for training`);
      onUploaded?.();
      void refreshDatasets();
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || "Failed to upload dataset";
      customToast.error(message);
    } finally {
      setUploading(false);
    }
  }, [file, onUploaded, refreshDatasets]);

  const handleFileSelected = useCallback((selected: File) => {
    readerRef.current?.abort();
    setSelectedId(null);
    setFile(selected);
    setPreview(null);
    setPreviewSource(null);
    setPreviewName(selected.name);
    setError(null);
    setProgress(0);
    setUploaded(false);

    if (selected.size > MAX_FILE_BYTES) {
      setPhase("error");
      setError(
        `File is too large to preview (${(selected.size / (1024 * 1024)).toFixed(1)} MB). The limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
      );
      return;
    }

    setPhase("reading");

    const reader = new FileReader();
    readerRef.current = reader;

    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    reader.onerror = () => {
      setPhase("error");
      setError("Failed to read the file.");
      readerRef.current = null;
    };

    reader.onload = () => {
      setProgress(100);
      setPhase("parsing");
      // Defer parsing so the "Parsing…" state paints before the (potentially
      // blocking) JSON.parse runs on the main thread.
      setTimeout(() => {
        try {
          const text = String(reader.result ?? "");
          const parsed = parseDatasetFile(text);
          setPreview(parsed);
          setPreviewSource("file");
          setPhase("ready");
        } catch (err) {
          const message =
            err instanceof DatasetParseError
              ? err.message
              : "Could not parse the dataset file.";
          setPhase("error");
          setError(message);
        } finally {
          readerRef.current = null;
        }
      }, 0);
    };

    reader.readAsText(selected);
  }, []);

  // Delete the dataset currently being previewed, removing it from the training
  // volume, then clear the preview and refresh the list.
  const handleDelete = useCallback(async () => {
    if (!selectedId) return;
    const name = previewName ?? selectedId;
    setDeleting(true);
    try {
      await deleteCustomDataset(selectedId);
      customToast.success(`Removed "${name}"`);
      reset();
      await refreshDatasets();
      onUploaded?.();
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || "Failed to delete dataset";
      customToast.error(message);
    } finally {
      setDeleting(false);
    }
  }, [selectedId, previewName, reset, refreshDatasets, onUploaded]);

  // Preview a dataset that is already stored on the server. It is already saved,
  // so uploading it again is disallowed (no "Save for Training" button).
  // Clicking the dataset that is already being previewed collapses the preview.
  const handleSelectExisting = useCallback(
    async (dataset: CustomDataset) => {
    if (selectedId === dataset.id) {
      reset();
      return;
    }
    readerRef.current?.abort();
    readerRef.current = null;
    setFile(null);
    setUploaded(false);
    setError(null);
    setProgress(0);
    setPreview(null);
    setPreviewSource(null);
    setPreviewName(dataset.name);
    setSelectedId(dataset.id);
    setPhase("parsing");

    try {
      const text = await fetchCustomDatasetContent(dataset.id);
      const parsed = parseDatasetFile(text);
      setPreview(parsed);
      setPreviewSource("existing");
      setPhase("ready");
    } catch (err) {
      let message = "Could not load the dataset.";
      if (err instanceof DatasetParseError) {
        message = err.message;
      } else {
        const apiError = (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error;
        if (apiError) message = apiError;
      }
      setPhase("error");
      setError(message);
    }
    },
    [selectedId, reset],
  );

  const isBusy = phase === "reading" || phase === "parsing";
  const canSave = phase === "ready" && preview && previewSource === "file";

  // The preview belongs to a stored dataset when a list item is selected;
  // otherwise it belongs to a freshly picked local file. Used to place the
  // preview/busy/error blocks above (existing) or below (new upload) the
  // "or upload new" divider.
  const existingContext = selectedId !== null;

  const previewArea = (
    <>
      {isBusy && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {phase === "reading"
              ? "Reading file…"
              : selectedId
                ? "Loading dataset…"
                : "Parsing…"}
          </div>
          <Progress value={phase === "parsing" ? 100 : progress} />
        </div>
      )}

      {phase === "error" && error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm dark:border-red-700 dark:bg-red-900/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <p className="text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {phase === "ready" && preview && (
        <>
          {previewName && (
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
              <FileJson className="h-4 w-4 text-gray-400" />
              <span className="truncate">{previewName}</span>
            </div>
          )}
          <DatasetPreview preview={preview} />
        </>
      )}

      {phase === "ready" && preview && (
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
          {previewSource === "existing" ? (
            <>
              <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Already saved for training
              </span>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Remove dataset
              </Button>
            </>
          ) : (
            <div className="ml-auto flex items-center gap-3">
              {uploaded && (
                <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Available for training
                </span>
              )}
              <Button
                onClick={handleUpload}
                disabled={uploading || uploaded || !canSave}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UploadCloud className="mr-2 h-4 w-4" />
                )}
                {uploaded ? "Uploaded" : "Save for Training"}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Custom Dataset Upload</CardTitle>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Upload a dataset JSON file, or select a previously uploaded one to
          preview its contents.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Previously uploaded datasets */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Uploaded datasets
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2"
              onClick={() => void refreshDatasets()}
              disabled={listLoading}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", listLoading && "animate-spin")}
              />
              Refresh
            </Button>
          </div>

          {listError && (
            <p className="text-sm text-red-600 dark:text-red-400">{listError}</p>
          )}

          {listLoading && datasets.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading datasets…
            </div>
          ) : datasets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              No datasets uploaded yet.
            </div>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-auto rounded-lg border border-gray-200 p-1 dark:border-gray-700">
              {datasets.map((dataset) => {
                const isSelected = selectedId === dataset.id;
                return (
                  <li key={dataset.id}>
                    <button
                      type="button"
                      onClick={() => void handleSelectExisting(dataset)}
                      disabled={isBusy}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                        "hover:bg-gray-100 dark:hover:bg-gray-800",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        isSelected &&
                          "bg-gray-100 ring-1 ring-inset ring-gray-300 dark:bg-gray-800 dark:ring-gray-600",
                      )}
                    >
                      <FileJson className="h-4 w-4 shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                          {dataset.name}
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">
                          {[
                            formatBytes(dataset.size_bytes),
                            dataset.modified_at
                              ? formatTrainingTimestamp(dataset.modified_at)
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      {isSelected && (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Preview for a previously uploaded dataset renders here, above the
              "or upload new" divider. */}
          {existingContext && previewArea}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
            or upload new
          </span>
          <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
        </div>

        <DatasetUploadField
          file={file}
          onFileSelected={handleFileSelected}
          onClear={reset}
          disabled={isBusy}
        />

        {/* Preview for a freshly selected local file renders here, below the
            upload field. */}
        {!existingContext && previewArea}
      </CardContent>
    </Card>
  );
}
