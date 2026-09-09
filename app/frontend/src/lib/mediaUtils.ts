// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Checks whether the browser supports audio capture via MediaDevices.
 * Restricts to secure contexts (HTTPS or localhost) per W3C specifications.
 */
export function isAudioRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.isSecureContext) &&
    Boolean(
      navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function"
    )
  );
}

export const INSECURE_CONTEXT_MIC_MESSAGE =
  "Microphone access requires a secure origin (HTTPS or localhost via SSH tunnel). You can still upload audio files.";

export const INSECURE_CONTEXT_TOOLTIP_MESSAGE =
  "Microphone requires a secure origin (HTTPS or localhost via SSH tunnel).";

/**
 * Normalizes browser MediaDevices / getUserMedia errors into user-friendly messages.
 */
export function getMicrophoneErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as { name?: string; message?: string };
    if (
      err.name === "NotAllowedError" ||
      err.name === "PermissionDeniedError"
    ) {
      return "Microphone permission denied. Please allow microphone access in your browser settings.";
    }
    if (
      err.name === "NotFoundError" ||
      err.name === "DevicesNotFoundError"
    ) {
      return "No microphone found. Please connect an audio input device.";
    }
    if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      return "Microphone is already in use by another application.";
    }
    if (err.message) {
      return `Microphone access error: ${err.message}`;
    }
  }
  return "Unable to access microphone. Please check your system settings.";
}
