// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@tenstorrent/vesper/button";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import {
  Close,
  ErrorSolid,
  Spinner,
  SuccessSolid,
  Upload,
} from "@tenstorrent/vesper/icons";
import { Select } from "@tenstorrent/vesper/select";
import { addToast } from "@tenstorrent/vesper/toast";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import { getErrorMessage } from "@/src/utils/errors";
import { formatFileSize } from "@/src/vesper/utils/format";
import {
  ACCEPTED_FILES,
  collectionNameForFile,
  useEmbeddingModels,
  useKnowledgeBaseActions,
} from "../hooks";

type StagedFile = {
  id: string;
  file: File;
  status: "staged" | "uploading" | "done" | "error";
  error?: string;
};

const DEFAULT_EMBEDDING = "__default__";

function FileBadge({ file }: { file: File }) {
  const extension =
    file.name.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE";
  return (
    <span className="w-10 h-10 shrink-0 flex items-center justify-center rounded-vesper-1 bg-vesper-tint-neutral-300">
      <Typography
        as="span"
        variant="label-xs-mono"
        className="text-vesper-text-primary"
      >
        {extension}
      </Typography>
    </span>
  );
}

export function UploadDropzone({
  existingCollections,
}: {
  existingCollections: string[];
}) {
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [embeddingModel, setEmbeddingModel] = useState(DEFAULT_EMBEDDING);
  const embeddingModels = useEmbeddingModels();
  const { uploadFile } = useKnowledgeBaseActions();
  const uploading = files.some((f) => f.status === "uploading");

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: ACCEPTED_FILES,
    noClick: files.length > 0,
    onDropAccepted: (accepted) =>
      setFiles((prev) => [
        ...prev.filter((f) => f.status !== "done"),
        ...accepted.map((file) => ({
          id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          status: "staged" as const,
        })),
      ]),
    onDropRejected: (rejections) =>
      addToast({
        variant: "warning",
        content: `Unsupported file type: ${rejections.map((r) => r.file.name).join(", ")}`,
        timeout: 6000,
      }),
  });

  const patch = (id: string, next: Partial<StagedFile>) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...next } : f)));

  const uploadAll = async () => {
    const known = [...existingCollections];
    let uploaded = 0;
    for (const staged of files.filter(
      (f) => f.status === "staged" || f.status === "error"
    )) {
      patch(staged.id, { status: "uploading", error: undefined });
      try {
        const name = await uploadFile(
          staged.file,
          known,
          embeddingModel === DEFAULT_EMBEDDING ? undefined : embeddingModel
        );
        known.push(name);
        uploaded += 1;
        patch(staged.id, { status: "done" });
      } catch (err) {
        patch(staged.id, { status: "error", error: getErrorMessage(err) });
      }
    }
    if (uploaded > 0) {
      addToast({
        variant: "success",
        content: `Uploaded ${uploaded} ${uploaded === 1 ? "file" : "files"}`,
        timeout: 4000,
      });
      // keep failed uploads around so they can be retried
      setTimeout(
        () => setFiles((prev) => prev.filter((f) => f.status !== "done")),
        1500
      );
    }
  };

  const embeddingOptions = embeddingModels.data ?? [];

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex flex-col items-center gap-vesper-6 px-vesper-6 py-vesper-12 rounded-vesper-4 border border-dashed text-center",
        "bg-vesper-background-secondary transition-colors duration-vesper-fast",
        isDragActive
          ? "border-vesper-border-accent-base bg-vesper-background-accent-subtle"
          : "border-vesper-border-primary",
        files.length === 0 && "cursor-pointer hover:border-vesper-border-strong"
      )}
    >
      <input {...getInputProps()} aria-label="Upload documents" />
      <div className="flex flex-col items-center gap-vesper-4">
        <span className="w-8 h-8 flex items-center justify-center rounded-vesper-1 bg-vesper-tint-neutral-300">
          <Upload className="w-5 h-5 text-vesper-icon-primary" aria-hidden />
        </span>
        <div className="flex flex-col gap-vesper-2">
          <Typography variant="copy-lg" className="text-vesper-text-primary">
            {isDragActive
              ? "Drop to add files"
              : "Drag and drop or click to upload"}
          </Typography>
          <Typography variant="copy-xs" className="text-vesper-text-secondary">
            PDF, DOCX, TXT, Markdown, HTML, CSV, JSON, YAML or source files.
            Each file becomes its own collection.
          </Typography>
        </div>
      </div>

      {files.length > 0 && (
        <div
          className="w-full max-w-lg flex flex-col gap-vesper-6"
          onClick={(e) => e.stopPropagation()}
        >
          <ul className="flex flex-col text-left">
            {files.map((staged) => (
              <li
                key={staged.id}
                className="flex items-center gap-vesper-4 py-vesper-3 border-b border-vesper-border-tertiary"
              >
                <FileBadge file={staged.file} />
                <div className="flex-1 min-w-0 flex flex-col gap-vesper-1">
                  <Typography
                    variant="copy-sm"
                    className="truncate text-vesper-text-primary"
                  >
                    {staged.file.name}
                  </Typography>
                  <Typography
                    variant="copy-xs"
                    className={cn(
                      "truncate",
                      staged.status === "error"
                        ? "text-vesper-text-error"
                        : "text-vesper-text-secondary"
                    )}
                  >
                    {staged.status === "error"
                      ? staged.error
                      : `${formatFileSize(staged.file.size)} · into "${collectionNameForFile(staged.file.name)}"`}
                  </Typography>
                </div>
                {staged.status === "uploading" && (
                  <Spinner className="w-5 h-5 animate-spin text-vesper-icon-tertiary" />
                )}
                {staged.status === "done" && (
                  <SuccessSolid className="w-5 h-5 text-vesper-icon-success" />
                )}
                {staged.status === "error" && (
                  <ErrorSolid className="w-5 h-5 text-vesper-icon-error" />
                )}
                {(staged.status === "staged" || staged.status === "error") && (
                  <IconButton
                    type="button"
                    size="xs"
                    variant="ghost"
                    icon={<Close />}
                    aria-label={`Remove ${staged.file.name}`}
                    onClick={() =>
                      setFiles((prev) => prev.filter((f) => f.id !== staged.id))
                    }
                  />
                )}
              </li>
            ))}
          </ul>
          {embeddingOptions.length > 0 && (
            <label className="flex flex-col gap-vesper-2 text-left">
              <Typography
                as="span"
                variant="label-sm"
                className="text-vesper-text-primary"
              >
                Embedding model for new collections
              </Typography>
              <Select
                aria-label="Embedding model"
                options={[
                  { value: DEFAULT_EMBEDDING, label: "Default (local)" },
                  ...embeddingOptions.map((m) => ({
                    value: m.hfModelId || m.modelName,
                    label: m.modelName,
                  })),
                ]}
                value={embeddingModel}
                onValueChange={(value) =>
                  setEmbeddingModel(value ?? DEFAULT_EMBEDDING)
                }
              />
            </label>
          )}
          <div className="flex items-center justify-center gap-vesper-3">
            <Button
              type="button"
              variant="subtle"
              disabled={
                uploading ||
                !files.some(
                  (f) => f.status === "staged" || f.status === "error"
                )
              }
              iconLeft={uploading && <Spinner className="animate-spin" />}
              onClick={() => void uploadAll()}
            >
              {uploading ? "Uploading" : "Upload files"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={uploading}
              onClick={open}
            >
              Add more
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
