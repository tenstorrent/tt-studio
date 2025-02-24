// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type React from "react";
import type { FileData } from "./types";
import {
  FileText,
  Image,
  File,
  Maximize2,
  Minimize2,
  FileCode2,
  FileIcon as FilePdf,
  FileJson,
  FileType2,
  FileSpreadsheet,
  FileArchive,
  FileVideo,
  FileAudio,
  FileImage,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

interface FileDisplayProps {
  files: FileData[];
  minimizedFiles: Set<string>;
  toggleMinimizeFile: (fileId: string) => void;
  onFileClick: (fileUrl: string, fileName: string) => void;
}

const isImageFile = (
  file: FileData
): file is FileData & { type: "image_url" } => file.type === "image_url";

const getFileExtension = (filename: string): string => {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
};

const getFileIcon = (file: FileData) => {
  if (isImageFile(file))
    return <FileImage className="h-5 w-5 text-purple-400" />;

  const extension = getFileExtension(file.name);
  switch (extension) {
    // Documents
    case "pdf":
      return <FilePdf className="h-5 w-5 text-red-400" />;
    case "doc":
    case "docx":
      return <FileText className="h-5 w-5 text-blue-400" />;
    case "xls":
    case "xlsx":
    case "csv":
      return <FileSpreadsheet className="h-5 w-5 text-green-400" />;

    // Code files
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return <FileCode2 className="h-5 w-5 text-yellow-400" />;
    case "py":
      return <FileCode2 className="h-5 w-5 text-blue-400" />;
    case "java":
      return <FileCode2 className="h-5 w-5 text-orange-400" />;
    case "cpp":
    case "c":
    case "h":
      return <FileCode2 className="h-5 w-5 text-pink-400" />;
    case "rs":
      return <FileCode2 className="h-5 w-5 text-orange-600" />;

    // Data files
    case "json":
      return <FileJson className="h-5 w-5 text-yellow-300" />;
    case "xml":
      return <FileType2 className="h-5 w-5 text-blue-300" />;
    case "yaml":
    case "yml":
      return <FileType2 className="h-5 w-5 text-green-300" />;

    // Archives
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
      return <FileArchive className="h-5 w-5 text-gray-400" />;

    // Media
    case "mp4":
    case "mov":
    case "avi":
      return <FileVideo className="h-5 w-5 text-purple-500" />;
    case "mp3":
    case "wav":
    case "ogg":
      return <FileAudio className="h-5 w-5 text-green-500" />;

    // Text
    case "txt":
    case "md":
    case "log":
      return <FileText className="h-5 w-5 text-gray-400" />;

    default:
      return <File className="h-5 w-5 text-gray-400" />;
  }
};

const FileDisplay: React.FC<FileDisplayProps> = ({
  files,
  minimizedFiles,
  toggleMinimizeFile,
  onFileClick,
}) => {
  if (!files || files.length === 0) return null;

  const imageFiles = files.filter(isImageFile);
  const otherFiles = files.filter((file) => !isImageFile(file));
  const allFiles = [...imageFiles, ...otherFiles];

  return (
    <TooltipProvider>
      <div className="flex flex-col w-full max-w-3xl px-4 gap-4 items-end">
        <div className="flex flex-wrap gap-4 justify-end">
          {allFiles.map((file, index) => {
            const fileId = isImageFile(file)
              ? file.image_url?.url || file.id || index.toString()
              : file.url || file.id || index.toString();
            const isMinimized = isImageFile(file)
              ? minimizedFiles.has(fileId)
              : true; // Files always start minimized

            if (isImageFile(file)) {
              return (
                <div key={`file-${index}`} className="relative group">
                  {!isMinimized ? (
                    <div className="relative">
                      <img
                        src={file.image_url?.url || "/placeholder.svg"}
                        alt={file.name}
                        className="w-[200px] h-[200px] object-contain cursor-pointer rounded-lg"
                        onClick={() =>
                          onFileClick(file.image_url?.url || "", file.name)
                        }
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => toggleMinimizeFile(fileId)}
                            className="absolute top-2 right-2 p-1 rounded-full bg-black/40 hover:bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                          >
                            <Minimize2 size={14} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <p>Minimize image</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-700/50 border border-gray-600">
                      <div
                        className="w-[40px] h-[40px] rounded-lg bg-gray-700 flex items-center justify-center cursor-pointer relative group"
                        onClick={() => toggleMinimizeFile(fileId)}
                      >
                        <Image className="h-5 w-5 text-gray-400" />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button className="absolute inset-0 w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              <Maximize2 size={14} className="text-gray-300" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            <p>Maximize image</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <span className="text-sm text-gray-300 truncate max-w-[150px]">
                        {file.name}
                      </span>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div
                key={`file-${index}`}
                className="flex items-center gap-2 p-2 rounded-lg bg-gray-700/50 border border-gray-600"
              >
                <div
                  className="w-[40px] h-[40px] rounded-lg bg-gray-700 flex items-center justify-center cursor-pointer relative group"
                  onClick={() => onFileClick(file.url || "", file.name)}
                >
                  {getFileIcon(file)}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        {file.size && (
                          <span className="sr-only">
                            {formatFileSize(file.size)}
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      {file.size && (
                        <p className="text-xs text-gray-400">
                          {formatFileSize(file.size)}
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <span className="text-sm text-gray-300 truncate max-w-[150px]">
                  {file.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
};

// Utility function to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + " B";
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  else return (bytes / 1048576).toFixed(1) + " MB";
};

export default FileDisplay;
