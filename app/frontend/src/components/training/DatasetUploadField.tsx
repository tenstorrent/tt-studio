// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { FileJson, UploadCloud, X } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

interface DatasetUploadFieldProps {
  /** Currently selected file, if any (controlled by the parent). */
  file: File | null;
  /** Called with the chosen file when the user drops or selects one. */
  onFileSelected: (file: File) => void;
  /** Clear the current selection. */
  onClear: () => void;
  /** Disable interaction (e.g. while a file is being read/parsed). */
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DatasetUploadField({
  file,
  onFileSelected,
  onClear,
  disabled = false,
}: DatasetUploadFieldProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      const next = accepted[0];
      if (next) onFileSelected(next);
    },
    [onFileSelected],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    disabled,
    noClick: true,
    noKeyboard: true,
    accept: { "application/json": [".json"] },
  });

  if (file) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50">
        <div className="flex min-w-0 items-center gap-3">
          <FileJson className="h-5 w-5 shrink-0 text-TT-purple-accent" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {file.name}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatBytes(file.size)}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={disabled}
        >
          <X className="mr-1 h-4 w-4" />
          Remove
        </Button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
        isDragActive
          ? "border-TT-purple-accent bg-TT-purple-accent/5"
          : "border-gray-300 dark:border-gray-600",
        disabled
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:border-TT-purple-accent/70",
      )}
      onClick={() => {
        if (!disabled) open();
      }}
    >
      <input {...getInputProps()} />
      <UploadCloud className="mb-3 h-8 w-8 text-gray-400 dark:text-gray-500" />
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {isDragActive
          ? "Drop the JSON file here"
          : "Drag & drop a dataset JSON file here"}
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        or click to browse. Expected: a JSON array of objects (.json)
      </p>
    </div>
  );
}
