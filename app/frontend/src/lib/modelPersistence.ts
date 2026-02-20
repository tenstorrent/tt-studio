// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { safeGetItem, safeSetItem, safeRemoveItem } from "./storage";

export interface ModelConnection {
  containerID: string;
  modelName: string;
  timestamp: number;
}

// Storage keys for each model page type
const STORAGE_KEYS = {
  chat: "last_model_chat",
  objectDetection: "last_model_object_detection",
  imageGen: "last_model_image_gen",
  speechToText: "last_model_speech_to_text",
} as const;

export type ModelPageType = keyof typeof STORAGE_KEYS;

// Max age: 7 days (stale connections are cleared)
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isConnectionStale(timestamp: number): boolean {
  return Date.now() - timestamp > MAX_AGE_MS;
}

export function saveModelConnection(
  pageType: ModelPageType,
  connection: Omit<ModelConnection, "timestamp">
): void {
  const fullConnection: ModelConnection = {
    ...connection,
    timestamp: Date.now(),
  };
  safeSetItem(STORAGE_KEYS[pageType], fullConnection);
}

export function getModelConnection(
  pageType: ModelPageType
): ModelConnection | null {
  const connection = safeGetItem<ModelConnection | null>(
    STORAGE_KEYS[pageType],
    null
  );

  if (!connection) return null;

  // Clear if stale
  if (isConnectionStale(connection.timestamp)) {
    clearModelConnection(pageType);
    return null;
  }

  return connection;
}

export function clearModelConnection(pageType: ModelPageType): void {
  safeRemoveItem(STORAGE_KEYS[pageType]);
}

export function clearAllModelConnections(): void {
  Object.keys(STORAGE_KEYS).forEach((key) =>
    clearModelConnection(key as ModelPageType)
  );
}
