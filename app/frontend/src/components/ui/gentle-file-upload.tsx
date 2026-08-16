// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import { cn } from "@/src/lib/utils";
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { IconUpload } from "@tabler/icons-react";
import { useDropzone } from "react-dropzone";
import { Progress } from "@/src/components/ui/progress";
import { Spinner } from "@/src/components/ui/spinner";
import { CheckCircle2, AlertCircle, X, FileText } from "lucide-react";

export interface UploadFileItem {
  id: string;
  file: File;
  status: "uploading" | "processing" | "success" | "error";
  progress?: number;
  statusText?: string;
  errorMessage?: string;
}

export interface GentleFileUploadProps {
  onChange?: (files: File[]) => void;
  files?: UploadFileItem[];
  onRemoveFile?: (id: string) => void;
  disabled?: boolean;
}

const mainVariant = {
  initial: {
    x: 0,
    y: 0,
  },
  animate: {
    x: 20,
    y: -20,
    opacity: 0.9,
  },
};

const secondaryVariant = {
  initial: {
    opacity: 0,
  },
  animate: {
    opacity: 1,
  },
};

export const GentleFileUpload = ({
  onChange,
  files: controlledFiles,
  onRemoveFile,
  disabled = false,
}: GentleFileUploadProps) => {
  const [internalFiles, setInternalFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (newFiles: File[]) => {
    if (disabled) return;
    setInternalFiles((prevFiles) => [...prevFiles, ...newFiles]);
    if (onChange) {
      onChange(newFiles);
    }
  };

  const handleClick = () => {
    if (disabled) return;
    fileInputRef.current?.click();
  };

  const { getRootProps, isDragActive } = useDropzone({
    multiple: true,
    noClick: true,
    disabled,
    onDrop: handleFileChange,
    onDropRejected: (error) => {
      console.warn("Drop rejected:", error);
    },
  });

  // If controlled files are provided, map them; otherwise convert internal files
  const displayFiles: UploadFileItem[] = controlledFiles
    ? controlledFiles
    : internalFiles.map((file, idx) => ({
      id: `internal-${file.name}-${idx}`,
      file,
      status: "processing" as const,
      progress: 100,
      statusText: "Ready",
    }));

  return (
    <div className="w-full" {...getRootProps()}>
      <motion.div
        onClick={handleClick}
        whileHover={disabled ? undefined : "animate"}
        className={cn(
          "p-10 group/file block rounded-lg cursor-pointer w-full relative overflow-hidden",
          disabled && "cursor-not-allowed opacity-80"
        )}
      >
        <input
          ref={fileInputRef}
          id="file-upload-handle"
          type="file"
          disabled={disabled}
          onChange={(e) => handleFileChange(Array.from(e.target.files || []))}
          className="hidden"
          multiple
          accept=".pdf,.txt,.log,.docx,.md,.html,.py,.js,.ts,.tsx,.jsx,.json,.xml,.yaml,.yml,.csv,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/html,application/json,text/xml,text/csv"
        />
        <div className="absolute inset-0 mask-[radial-gradient(ellipse_at_center,white,transparent)]">
          <GridPattern />
        </div>
        <div className="flex flex-col items-center justify-center">
          <p className="relative z-20 font-sans font-bold text-neutral-700 dark:text-neutral-300 text-base">
            Upload Documents to Create RAG Datasources
          </p>
          <p className="relative z-20 font-sans font-normal text-neutral-400 dark:text-neutral-400 text-base mt-2 text-center">
            Drag & drop files here or click to browse. Datasources will be created automatically using file names.
          </p>

          <div className="relative w-full mt-10 max-w-xl mx-auto space-y-3">
            {displayFiles.length > 0 &&
              displayFiles.map((item, idx) => {
                const isProcessing =
                  item.status === "uploading" || item.status === "processing";
                const isSuccess = item.status === "success";
                const isError = item.status === "error";

                return (
                  <motion.div
                    key={item.id || `file-${idx}`}
                    layoutId={idx === 0 ? "file-upload" : `file-upload-${idx}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "relative overflow-hidden z-40 bg-white dark:bg-neutral-900 flex flex-col p-4 w-full mx-auto rounded-lg border shadow-sm transition-all",
                      isProcessing &&
                      "border-blue-300 dark:border-blue-800/60 shadow-blue-500/5",
                      isSuccess &&
                      "border-green-300 dark:border-green-800/60 shadow-green-500/5",
                      isError &&
                      "border-red-300 dark:border-red-800/60 shadow-red-500/5",
                      !isProcessing &&
                      !isSuccess &&
                      !isError &&
                      "border-neutral-200 dark:border-neutral-800"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Top Row: File Name, Size & Status Badge */}
                    <div className="flex justify-between w-full items-center gap-3">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div
                          className={cn(
                            "p-2 rounded-md shrink-0",
                            isProcessing &&
                            "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400",
                            isSuccess &&
                            "bg-green-50 dark:bg-green-950/50 text-green-600 dark:text-green-400",
                            isError &&
                            "bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400",
                            !isProcessing &&
                            !isSuccess &&
                            !isError &&
                            "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                          )}
                        >
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate"
                            title={item.file.name}
                          >
                            {item.file.name}
                          </p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {(item.file.size / (1024 * 1024)).toFixed(2)} MB •{" "}
                            {item.file.name.split(".").pop()?.toUpperCase() ||
                              "FILE"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isProcessing && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            <Spinner size="xs" />
                            <span className="hidden sm:inline">Processing</span>
                          </span>
                        )}
                        {isSuccess && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300 border border-green-200 dark:border-green-800">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Ready</span>
                          </span>
                        )}
                        {isError && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Failed</span>
                          </span>
                        )}
                        {onRemoveFile && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveFile(item.id);
                            }}
                            className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                            title="Dismiss"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar & Status Text */}
                    <div className="w-full mt-3">
                      <div className="flex justify-between items-center text-xs mb-1">
                        <span
                          className={cn(
                            "font-medium truncate pr-2",
                            isProcessing && "text-blue-600 dark:text-blue-400",
                            isSuccess && "text-green-600 dark:text-green-400",
                            isError && "text-red-600 dark:text-red-400",
                            !isProcessing &&
                            !isSuccess &&
                            !isError &&
                            "text-neutral-500"
                          )}
                        >
                          {isError
                            ? item.errorMessage || "Failed to process document"
                            : item.statusText ||
                            (isSuccess
                              ? "Document indexed successfully"
                              : "Uploading...")}
                        </span>
                        {isProcessing && (
                          <span className="text-neutral-500 shrink-0">
                            {item.progress ?? 0}%
                          </span>
                        )}
                      </div>
                      <Progress
                        value={item.progress ?? (isSuccess ? 100 : 0)}
                        className="h-1.5 w-full bg-neutral-100 dark:bg-neutral-800"
                        indicatorClassName={cn(
                          "transition-all duration-300 ease-out",
                          isProcessing && "bg-blue-600 dark:bg-blue-500",
                          isSuccess && "bg-green-600 dark:bg-green-500",
                          isError && "bg-red-600 dark:bg-red-500"
                        )}
                      />
                    </div>
                  </motion.div>
                );
              })}

            {!displayFiles.length && (
              <motion.div
                layoutId="file-upload"
                variants={mainVariant}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 20,
                }}
                className={cn(
                  "relative group-hover/file:shadow-2xl z-40 bg-white dark:bg-neutral-900 flex items-center justify-center h-32 mt-4 w-full max-w-[8rem] mx-auto rounded-md",
                  "shadow-[0px_10px_50px_rgba(0,0,0,0.1)]"
                )}
              >
                {isDragActive ? (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-neutral-600 flex flex-col items-center"
                  >
                    Drop it
                    <IconUpload className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
                  </motion.p>
                ) : (
                  <IconUpload className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
                )}
              </motion.div>
            )}

            {!displayFiles.length && (
              <motion.div
                variants={secondaryVariant}
                className="absolute opacity-0 border border-dashed border-TT-purple-accent inset-0 z-30 bg-transparent flex items-center justify-center h-32 mt-4 w-full max-w-[8rem] mx-auto rounded-md"
              ></motion.div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export function GridPattern() {
  const columns = 41;
  const rows = 11;
  return (
    <div className="flex bg-gray-100 dark:bg-neutral-900 shrink-0 flex-wrap justify-center items-center gap-x-px gap-y-px  scale-105">
      {Array.from({ length: rows }).map((_, row) =>
        Array.from({ length: columns }).map((_, col) => {
          const index = row * columns + col;
          return (
            <div
              key={`${col}-${row}`}
              className={`w-10 h-10 flex shrink-0 rounded-[2px] ${index % 2 === 0
                ? "bg-gray-50 dark:bg-neutral-950"
                : "bg-gray-50 dark:bg-neutral-950 shadow-[0px_0px_1px_3px_rgba(255,255,255,1)_inset] dark:shadow-[0px_0px_1px_3px_rgba(0,0,0,1)_inset]"
                }`}
            />
          );
        })
      )}
    </div>
  );
}
