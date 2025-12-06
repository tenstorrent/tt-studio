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

// Function to get friendly file type name for display
const getFileTypeName = (filename: string): string => {
  const extension = getFileExtension(filename);

  // Document types
  if (["pdf"].includes(extension)) return "PDF";
  if (["doc", "docx"].includes(extension)) return "Doc";
  if (["xls", "xlsx", "csv"].includes(extension)) return "Sheet";

  // Code files
  if (
    ["js", "jsx", "ts", "tsx", "py", "java", "cpp", "c", "h", "rs"].includes(
      extension
    )
  )
    return "Code";

  // Data files
  if (["json", "xml", "yaml", "yml"].includes(extension)) return "Data";

  // Archives
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) return "Archive";

  // Media
  if (["mp4", "mov", "avi"].includes(extension)) return "Video";
  if (["mp3", "wav", "ogg"].includes(extension)) return "Audio";
  if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(extension))
    return "Image";

  // Text
  if (["txt", "md", "log"].includes(extension)) return "Text";

  // Default
  return "File";
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

// Function to get appropriate background color for file type badges
const getFileTypeBgColor = (filename: string): string => {
  const extension = getFileExtension(filename);

  // Documents
  if (["pdf"].includes(extension)) return "bg-red-500/80";
  if (["doc", "docx"].includes(extension)) return "bg-blue-500/80";
  if (["xls", "xlsx", "csv"].includes(extension)) return "bg-green-500/80";

  // Code files
  if (["js", "jsx", "ts", "tsx"].includes(extension)) return "bg-yellow-500/80";
  if (["py"].includes(extension)) return "bg-blue-600/80";
  if (["java"].includes(extension)) return "bg-orange-500/80";
  if (["cpp", "c", "h"].includes(extension)) return "bg-pink-500/80";
  if (["rs"].includes(extension)) return "bg-orange-600/80";

  // Data files
  if (["json"].includes(extension)) return "bg-yellow-400/80";
  if (["xml", "yaml", "yml"].includes(extension)) return "bg-blue-400/80";

  // Archives
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension))
    return "bg-gray-500/80";

  // Media
  if (["mp4", "mov", "avi"].includes(extension)) return "bg-purple-500/80";
  if (["mp3", "wav", "ogg"].includes(extension)) return "bg-green-600/80";

  // Text
  if (["txt", "md", "log"].includes(extension)) return "bg-gray-500/80";

  // Default
  return "bg-gray-500/80";
};

const FileDisplay: React.FC<FileDisplayProps> = ({
  files,
  minimizedFiles,
  toggleMinimizeFile,
  onFileClick,
}) => {
  if (!files || files.length === 0) return null;

  // console.log("Files:", files);
  const imageFiles = files.filter(isImageFile);
  const otherFiles = files.filter((file) => !isImageFile(file));
  const allFiles = [...imageFiles, ...otherFiles];

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4 -mr-3">
        <div className="flex flex-wrap gap-4 justify-end w-fit ml-auto">
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

                      {/* File type badge for expanded images */}
                      <div className="absolute bottom-2 left-2 text-xs px-1.5 py-0.5 rounded bg-purple-500/80 text-white">
                        Image
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Desktop view for minimized images */}
                      <div className="hidden sm:flex items-center gap-2 p-2 rounded-lg bg-gray-700/50 border border-gray-600">
                        <div
                          className="w-[40px] h-[40px] rounded-lg bg-gray-700 flex items-center justify-center cursor-pointer relative group"
                          onClick={() => toggleMinimizeFile(fileId)}
                        >
                          <Image className="h-5 w-5 text-gray-400" />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button className="absolute inset-0 w-full h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                <Maximize2
                                  size={14}
                                  className="text-gray-300"
                                />
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

                      {/* Mobile view for minimized images */}
                      <div className="sm:hidden relative group touch-manipulation">
                        <button
                          className="w-[40px] h-[40px] rounded-lg bg-gray-700/50 border border-gray-600 flex items-center justify-center cursor-pointer"
                          onClick={() => toggleMinimizeFile(fileId)}
                          onTouchStart={(e) => {
                            // Prevent default to ensure touch works properly
                            e.preventDefault();
                            toggleMinimizeFile(fileId);
                          }}
                        >
                          <Image className="h-5 w-5 text-gray-400" />

                          {/* File type badge for mobile */}
                          <div className="absolute -bottom-1 -right-1 text-[8px] px-1 py-0 rounded-full bg-purple-500/80 text-white font-medium">
                            IMG
                          </div>
                        </button>

                        {/* Hover/tap info for mobile - positioned to avoid going off screen */}
                        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-10 bg-gray-800 rounded-md p-2 shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity duration-200 min-w-max">
                          <div className="text-xs text-gray-300 whitespace-nowrap">
                            {file.name}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            }

            // Get file type for display
            const fileType = getFileTypeName(file.name);
            const fileTypeBg = getFileTypeBgColor(file.name);
            const shortFileType = fileType.substring(0, 3).toUpperCase();

            return (
              <div key={`file-${index}`}>
                {/* Desktop view for regular files */}
                <div className="hidden sm:flex items-center gap-2 p-2 rounded-lg bg-gray-700/50 border border-gray-600">
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

                {/* Mobile view for regular files */}
                <div className="sm:hidden relative group touch-manipulation">
                  <button
                    className="w-[40px] h-[40px] rounded-lg bg-gray-700/50 border border-gray-600 flex items-center justify-center cursor-pointer"
                    onClick={() => onFileClick(file.url || "", file.name)}
                    onTouchStart={(e) => {
                      // Prevent default to ensure touch works properly
                      e.preventDefault();
                      onFileClick(file.url || "", file.name);
                    }}
                  >
                    {getFileIcon(file)}

                    {/* File type badge for mobile */}
                    <div
                      className={`absolute -bottom-1 -right-1 text-[8px] px-1 py-0 rounded-full ${fileTypeBg} text-white font-medium`}
                    >
                      {shortFileType}
                    </div>
                  </button>

                  {/* Hover/tap info for mobile - positioned to avoid going off screen */}
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-10 bg-gray-800 rounded-md p-2 shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity duration-200 min-w-max">
                    <div className="text-xs text-gray-300 whitespace-nowrap">
                      {file.name}
                      <div className="flex items-center gap-1.5 mt-1">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${fileTypeBg} text-white`}
                        >
                          {fileType}
                        </span>
                        {file.size && (
                          <span className="text-[10px] text-gray-400">
                            {formatFileSize(file.size)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
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
