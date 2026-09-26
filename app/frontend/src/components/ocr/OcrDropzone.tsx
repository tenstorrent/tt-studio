// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/*
 * Drop target for the OCR page.
 *
 * A fork of the drop target in ui/gentle-file-upload.tsx rather than a new prop
 * on it: that component hardcodes RAG document types and RAG copy, is rendered
 * by RagManagement, and sits under an eslint ignore, so widening it for another
 * page's benefit would carry risk with no lint safety net. The only genuinely
 * shared piece is the backdrop, and GridPattern is already exported, so this
 * imports it and the two pages still look like the same product.
 *
 * Validation lives in the caller (useOcrRun.addFiles); this only reports what
 * the browser itself refused.
 */

import { useRef } from "react";
import { motion } from "framer-motion";
import { IconUpload } from "@tabler/icons-react";
import { useDropzone } from "react-dropzone";

import { cn } from "@/src/lib/utils";
import { GridPattern } from "@/src/components/ui/gentle-file-upload";
import { customToast } from "../CustomToaster";
import { OCR_ACCEPT_TYPES, OCR_MAX_IMAGES } from "./lib/ocrClient";

export interface OcrDropzoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  remainingSlots: number;
}

export function OcrDropzone({
  onFiles,
  disabled = false,
  remainingSlots,
}: OcrDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const { getRootProps, isDragActive } = useDropzone({
    multiple: true,
    noClick: true,
    disabled,
    accept: { "image/*": [] },
    onDrop: onFiles,
    onDropRejected: (rejections) => {
      const names = rejections.slice(0, 3).map((r) => r.file.name);
      customToast.error(
        `Could not accept ${names.join(", ")}${
          rejections.length > 3 ? ` and ${rejections.length - 3} more` : ""
        }. Images only.`,
      );
    },
  });

  return (
    <div className="w-full" {...getRootProps()}>
      <motion.div
        onClick={handleClick}
        whileHover={disabled ? undefined : "animate"}
        className={cn(
          "p-10 group/file block rounded-lg w-full relative overflow-hidden border border-neutral-200 dark:border-neutral-800",
          disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer",
        )}
      >
        <input
          ref={fileInputRef}
          id="ocr-upload-handle"
          type="file"
          disabled={disabled}
          onChange={(e) => {
            onFiles(Array.from(e.target.files || []));
            // Allow re-picking the same file after a removal.
            e.target.value = "";
          }}
          className="hidden"
          multiple
          accept={OCR_ACCEPT_TYPES.join(",")}
        />

        <div className="absolute inset-0 mask-[radial-gradient(ellipse_at_center,white,transparent)]">
          <GridPattern />
        </div>

        <div className="flex flex-col items-center justify-center">
          <p className="relative z-20 font-sans font-bold text-neutral-700 dark:text-neutral-300 text-base">
            Drop photos to read their text
          </p>
          <p className="relative z-20 font-sans font-normal text-neutral-400 dark:text-neutral-400 text-base mt-2 text-center">
            Drag and drop images here or click to browse. Up to {OCR_MAX_IMAGES}{" "}
            per run
            {remainingSlots < OCR_MAX_IMAGES
              ? `, ${remainingSlots} slot${remainingSlots === 1 ? "" : "s"} left`
              : ""}
            .
          </p>

          <div
            className={cn(
              "relative z-40 bg-white dark:bg-neutral-900 flex items-center justify-center h-32 mt-8 w-full max-w-[8rem] mx-auto rounded-md",
              "shadow-[0px_10px_50px_rgba(0,0,0,0.1)] group-hover/file:shadow-2xl transition-shadow",
            )}
          >
            {isDragActive ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-neutral-600 dark:text-neutral-300 flex flex-col items-center text-sm"
              >
                Drop them
                <IconUpload className="h-4 w-4 mt-1" />
              </motion.p>
            ) : (
              <IconUpload className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default OcrDropzone;
