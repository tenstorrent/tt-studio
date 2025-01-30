// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export const encodeFileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file provided"));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result as string;
      // Include both prefix and data for compatibility with Python reference implementation
      const base64Data = result.split(",")[1];
      resolve(base64Data);
    };

    reader.onerror = (error) => {
      console.error("File reading error:", error);
      reject(new Error("Failed to read file"));
    };

    reader.onabort = () => {
      reject(new Error("File reading aborted"));
    };

    try {
      // Read as Data URL to get proper formatting
      reader.readAsDataURL(file);
    } catch (error) {
      reject(
        new Error(
          `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`
        )
      );
    }
  });
};

// Strict validation for supported image types (matches Python reference requirements)
export const isImageFile = (file: File): boolean => {
  const supportedMimeTypes = [
    "image/png", // Primary supported type
    "image/jpeg", // Add if server supports JPEG
    "image/webp", // Add if server supports WebP
  ];

  return supportedMimeTypes.includes(file.type);
};

// Enhanced validation with server requirements
export const validateFile = (
  file: File,
  maxSizeMB = 10
): { valid: boolean; error?: string } => {
  if (!file) return { valid: false, error: "No file provided" };

  // Size validation (matches Python reference limits)
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      error: `File size exceeds ${maxSizeMB}MB limit (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
    };
  }

  // Strict type validation
  if (!isImageFile(file)) {
    return {
      valid: false,
      error: `Unsupported file type. Only ${supportedMimeTypes.join(", ")} are allowed`,
    };
  }

  return { valid: true };
};

// List of supported MIME types for error messages
const supportedMimeTypes = ["PNG", "JPEG", "WebP"];
