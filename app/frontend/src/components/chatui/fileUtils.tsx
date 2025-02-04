// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { customToast } from "../CustomToaster"

export const encodeFile = (file: File, base64Encoded = true): Promise<string> => {
  return new Promise((resolve, reject) => {
    console.log("Starting file encoding process...")
    console.log(`File name: ${file.name}, Size: ${file.size} bytes, Type: ${file.type}`)
    console.log(`Encoding mode: ${base64Encoded ? "Base64" : "Raw binary"}`)

    if (!file) {
      console.error("No file provided")
      reject(new Error("No file provided"))
      return
    }

    const reader = new FileReader()

    reader.onload = () => {
      console.log("File read successfully")
      const result = reader.result as string

      if (base64Encoded) {
        // Extract only the base64 data without the data URI prefix
        const base64Data = result.split(",")[1]
        console.log(`Base64 encoded data (first 50 chars): ${base64Data.substring(0, 50)}...`)
        resolve(base64Data)
        customToast.success(`File name: ${file.name}, uploaded sucessfully!🎉`)
      } else {
        // Return raw binary data
        console.log(`Raw binary data length: ${result.length} bytes`)
        resolve(result)
      }
    }

    reader.onerror = (error) => {
      customToast.error(`Error uploading file: ${file.name} only supports PNG, JPEG, and WebP images.`)
      console.error("File reading error:", error)
      reject(new Error("Failed to read file"))
    }

    reader.onabort = () => {
      console.warn("File reading aborted")
      reject(new Error("File reading aborted"))
    }

    try {
      if (base64Encoded) {
        console.log("Reading file as Data URL...")
        reader.readAsDataURL(file)
      } else {
        console.log("Reading file as ArrayBuffer...")
        reader.readAsArrayBuffer(file)
      }
    } catch (error) {
      console.error("Error during file reading:", error)
      reject(new Error(`Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`))
    }
  })
}

export const isImageFile = (file: File): boolean => {
  const supportedMimeTypes = ["image/png", "image/jpeg", "image/webp"]
  const result = supportedMimeTypes.includes(file.type)
  console.log(`File type check: ${file.type} - Is supported image: ${result}`)
  return result
}

export const validateFile = (file: File, maxSizeMB = 10): { valid: boolean; error?: string } => {
  console.log(`Validating file: ${file.name}`)

  if (!file) {
    console.error("No file provided for validation")
    return { valid: false, error: "No file provided" }
  }

  const maxSizeBytes = maxSizeMB * 1024 * 1024
  if (file.size > maxSizeBytes) {
    console.warn(`File size (${file.size} bytes) exceeds limit of ${maxSizeBytes} bytes`)
    return {
      valid: false,
      error: `File size exceeds ${maxSizeMB}MB limit (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
    }
  }

  if (!isImageFile(file)) {
    console.warn(`Unsupported file type: ${file.type}`)
    return {
      valid: false,
      error: `Unsupported file type. Only PNG, JPEG,and WebP images are allowed.`,
    }
  }

  console.log("File validation passed")
  return { valid: true }
}

