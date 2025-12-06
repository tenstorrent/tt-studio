// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type { FileData } from "./types";

export function processUploadedFiles(files: FileData[]): FileData {
  if (!files || files.length === 0) {
    return {} as FileData;
  }

  if (files.length === 1 || files[0].type !== "text") {
    return files[0];
  }
  const textFiles = files.filter((file) => file.type === "text" && file.text);

  if (textFiles.length === 0) {
    return files[0];
  }

  const combinedText = textFiles.map((file) => file.text).join("\n\n");
  // console.log(`Processed ${textFiles.length} text files into single content`);

  return {
    type: "text",
    text: combinedText,
    name: `combined_${textFiles.length}_files.txt`,
  } as FileData;
}

// Usage example:
/*
const files = request.files
console.log("Uploaded files:", files)
const file = processUploadedFiles(files)

// Now you can use 'file' as before
if (file.type === "text" && file.text) {
  // Handle text content
} else if (file.image_url?.url || file) {
  // Handle image
}
*/
