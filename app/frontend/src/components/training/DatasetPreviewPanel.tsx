// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Loader2, UploadCloud, CheckCircle2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Progress } from "../ui/progress";
import { Button } from "../ui/button";
import { DatasetUploadField } from "./DatasetUploadField";
import { DatasetPreview } from "./DatasetPreview";
import {
  parseDatasetFile,
  DatasetParseError,
  type DatasetPreview as DatasetPreviewData,
} from "./datasetPreview";
import { uploadCustomDataset } from "../../api/trainingApi";
import { customToast } from "../CustomToaster";

// Guard against reading arbitrarily large files into memory for a client-side
// preview. 25 MB is generous for a JSON dataset sample.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

type Phase = "idle" | "reading" | "parsing" | "ready" | "error";

interface DatasetPreviewPanelProps {
  // Notified after a dataset is successfully uploaded to the server so parents
  // (e.g. the training dialog) can refresh their custom-dataset list.
  onUploaded?: () => void;
}

export function DatasetPreviewPanel({ onUploaded }: DatasetPreviewPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DatasetPreviewData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const readerRef = useRef<FileReader | null>(null);

  const reset = useCallback(() => {
    readerRef.current?.abort();
    readerRef.current = null;
    setFile(null);
    setPhase("idle");
    setProgress(0);
    setError(null);
    setPreview(null);
    setUploading(false);
    setUploaded(false);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadCustomDataset(file);
      setUploaded(true);
      customToast.success(`Uploaded "${file.name}" for training`);
      onUploaded?.();
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error || "Failed to upload dataset";
      customToast.error(message);
    } finally {
      setUploading(false);
    }
  }, [file, onUploaded]);

  const handleFileSelected = useCallback((selected: File) => {
    readerRef.current?.abort();
    setFile(selected);
    setPreview(null);
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

  const isBusy = phase === "reading" || phase === "parsing";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Custom Dataset Upload</CardTitle>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Upload a dataset JSON file to preview its contents before training.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <DatasetUploadField
          file={file}
          onFileSelected={handleFileSelected}
          onClear={reset}
          disabled={isBusy}
        />

        {isBusy && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              {phase === "reading" ? "Reading file…" : "Parsing…"}
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

        {phase === "ready" && preview && <DatasetPreview preview={preview} />}

        {phase === "ready" && preview && (
          <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
            {uploaded && (
              <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Available for training
              </span>
            )}
            <Button onClick={handleUpload} disabled={uploading || uploaded}>
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="mr-2 h-4 w-4" />
              )}
              {uploaded ? "Uploaded" : "Save for Training"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
