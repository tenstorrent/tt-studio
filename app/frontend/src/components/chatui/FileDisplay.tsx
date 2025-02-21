// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { FileData } from "./types";
import { FileText, Image, File, Maximize2, Minimize2 } from "lucide-react";

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
  if (isImageFile(file)) return <Image className="h-5 w-5" />;

  const extension = getFileExtension(file.name);
  switch (extension) {
    case "pdf":
      return <FileText className="h-5 w-5 text-red-400" />;
    case "doc":
    case "docx":
      return <FileText className="h-5 w-5 text-blue-400" />;
    case "xls":
    case "xlsx":
      return <FileText className="h-5 w-5 text-green-400" />;
    case "txt":
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

  return (
    <div className="bg-gray-800 p-2 rounded mt-2">
      {imageFiles.length > 0 && (
        <>
          <p className="text-white mb-2 font-semibold">
            Attached Images ({imageFiles.length}):
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {imageFiles.map((file, index) => {
              const fileId = file.image_url?.url || file.id || index.toString();
              return (
                <div
                  key={`img-${index}`}
                  className="relative group max-w-[150px] rounded-lg overflow-hidden border border-gray-700 transition-all duration-300 hover:shadow-lg"
                >
                  {!minimizedFiles.has(fileId) ? (
                    <img
                      src={file.image_url?.url || "/placeholder.svg"}
                      alt={file.name}
                      className="object-cover w-full h-[100px]"
                      onClick={() =>
                        onFileClick(file.image_url?.url || "", file.name)
                      }
                    />
                  ) : (
                    <div className="w-full h-[30px] bg-gray-700 flex items-center justify-center">
                      <Image className="h-4 w-4 text-gray-400" />
                    </div>
                  )}
                  <div className="p-1 bg-gray-700 text-xs text-gray-300 truncate flex justify-between items-center">
                    <span className="truncate flex-grow">{file.name}</span>
                    <button
                      onClick={() => toggleMinimizeFile(fileId)}
                      className="ml-2 text-gray-300 hover:text-white flex-shrink-0"
                    >
                      {minimizedFiles.has(fileId) ? (
                        <Maximize2 size={14} />
                      ) : (
                        <Minimize2 size={14} />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {otherFiles.length > 0 && (
        <>
          <p className="text-white mb-2 font-semibold">
            Attached Files ({otherFiles.length}):
          </p>
          <div className="flex flex-col gap-2">
            {otherFiles.map((file, index) => {
              return (
                <div
                  key={`file-${index}`}
                  className="flex items-center p-2 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
                  onClick={() => onFileClick(file.url || "", file.name)}
                >
                  {getFileIcon(file)}
                  <span className="ml-2 text-sm text-gray-200 truncate">
                    {file.name}
                  </span>
                  {file.size && (
                    <span className="ml-auto text-xs text-gray-400">
                      {formatFileSize(file.size)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

// Utility function to format file size
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + " B";
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  else return (bytes / 1048576).toFixed(1) + " MB";
};

export default FileDisplay;
