// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  createCollection,
  deleteCollection,
  fetchDocuments,
  uploadDocument,
} from "@/src/components/rag";
import { fetchEmbeddingModels } from "@/src/api/modelsDeployedApis";
import {
  COLLECTIONS_QUERY_KEY,
  useCollections,
  type Collection,
} from "@/src/vesper/hooks/use-collections";

export { useCollections, type Collection };

export interface CollectionDocument {
  filename: string;
  folder_type: string;
  folder_path: string;
  file_extension: string;
  display_path: string;
  chunks_count: number;
  upload_date: string;
}

/** Accepted upload types, matching what the backend can index. */
export const ACCEPTED_FILES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "text/plain": [".txt", ".log"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "text/markdown": [".md"],
  "text/html": [".html"],
  "text/csv": [".csv"],
  "application/json": [".json"],
  "text/xml": [".xml"],
  "application/x-yaml": [".yaml", ".yml"],
  "text/x-python": [".py"],
  "text/javascript": [".js", ".jsx"],
  "text/typescript": [".ts", ".tsx"],
};

/** `My Notes (v2).pdf` -> `my_notes_v2`, the same naming the old page used. */
export function collectionNameForFile(fileName: string) {
  return fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

/** The documents in each collection, in the same order as `names`. */
export function useCollectionDocuments(names: string[]) {
  return useQueries({
    queries: names.map((name) => ({
      queryKey: ["collection-documents", name],
      queryFn: async () => {
        const data = await fetchDocuments(name);
        return {
          documents: (data.documents ?? []) as CollectionDocument[],
          totalFiles: (data.total_files ?? 0) as number,
        };
      },
    })),
  });
}

/** Deployed embedding models a new collection can be backed by. */
export function useEmbeddingModels() {
  return useQuery({
    queryKey: ["embedding-models"],
    queryFn: fetchEmbeddingModels,
    refetchInterval: 15_000,
  });
}

/** Upload helpers that keep the collections and document lists fresh. */
export function useKnowledgeBaseActions() {
  const queryClient = useQueryClient();

  const refresh = useCallback(
    (collectionName?: string) => {
      queryClient.invalidateQueries({ queryKey: COLLECTIONS_QUERY_KEY });
      if (collectionName) {
        queryClient.invalidateQueries({
          queryKey: ["collection-documents", collectionName],
        });
      }
    },
    [queryClient]
  );

  /**
   * Upload a file into the collection named after it, creating the collection
   * first when it doesn't exist (and removing it again if the upload fails).
   */
  const uploadFile = useCallback(
    async (file: File, existing: string[], embeddingModel?: string) => {
      const collectionName = collectionNameForFile(file.name);
      if (collectionName.length < 2) {
        throw new Error(
          "Rename the file: its name is too short for a collection."
        );
      }
      if (existing.includes(collectionName)) {
        await uploadDocument({ file, collectionName });
      } else {
        await createCollection({
          collectionName,
          ttEmbeddingModel: embeddingModel,
        });
        try {
          await uploadDocument({ file, collectionName });
        } catch (err) {
          await deleteCollection({ collectionName }).catch(() => undefined);
          throw err;
        }
      }
      refresh(collectionName);
      return collectionName;
    },
    [refresh]
  );

  const uploadToCollection = useCallback(
    async (file: File, collectionName: string) => {
      await uploadDocument({ file, collectionName });
      refresh(collectionName);
    },
    [refresh]
  );

  const removeCollection = useCallback(
    async (collectionName: string) => {
      await deleteCollection({ collectionName });
      refresh(collectionName);
    },
    [refresh]
  );

  return { uploadFile, uploadToCollection, removeCollection };
}
