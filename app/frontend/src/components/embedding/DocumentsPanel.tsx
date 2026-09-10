// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useState } from "react";
import { Search, Loader2, FileText, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  GentleFileUpload,
  type UploadFileItem,
} from "../ui/gentle-file-upload";
import { customToast } from "../CustomToaster";
import {
  fetchCollections,
  createCollection,
  deleteCollection,
  uploadDocument,
  fetchDocuments,
  queryCollection,
  type CollectionQueryResult,
} from "../rag";
import { type RagDataSource } from "../chatui/types";

interface DocumentsPanelProps {
  /** hf_model_id (preferred) or model_name of the currently-selected embedding
   * model -- the stable identity a collection is locked to (see EmbeddingDemo). */
  modelIdentifier: string;
}

interface DocEntry {
  filename: string;
  chunks_count: number;
  upload_date?: string;
}

const generateCollectionName = (fileName: string): string =>
  fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();

export default function DocumentsPanel({
  modelIdentifier,
}: DocumentsPanelProps) {
  const embedFuncName = `tt-embed:${modelIdentifier}`;

  const [collections, setCollections] = useState<RagDataSource[]>([]);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [documents, setDocuments] = useState<DocEntry[]>([]);
  const [uploadFiles, setUploadFiles] = useState<UploadFileItem[]>([]);
  const [queryText, setQueryText] = useState("");
  const [queryResults, setQueryResults] = useState<CollectionQueryResult | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadCollections = useCallback(async () => {
    try {
      const all: RagDataSource[] = await fetchCollections();
      const matching = all.filter(
        (c) => c.metadata?.embedding_func_name === embedFuncName
      );
      setCollections(matching);
      return matching;
    } catch {
      customToast.error("Failed to load collections for this model");
      return [];
    } finally {
      setLoadingCollections(false);
    }
  }, [embedFuncName]);

  // Model switched: this panel's collection list is model-scoped, so reset.
  useEffect(() => {
    setSelectedCollection("");
    setDocuments([]);
    setQueryResults(null);
    setLoadingCollections(true);
    loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    if (!selectedCollection) {
      setDocuments([]);
      return;
    }
    fetchDocuments(selectedCollection)
      .then((d) => setDocuments(d.documents || []))
      .catch(() => setDocuments([]));
  }, [selectedCollection]);

  const handleFilesSelected = async (files: File[]) => {
    for (const file of files) {
      const uploadId = `${file.name}-${Date.now()}-${Math.random()}`;
      setUploadFiles((prev) => [
        ...prev,
        { id: uploadId, file, status: "loading", progress: 20, statusText: "Uploading…" },
      ]);

      try {
        let targetCollection = selectedCollection;
        if (!targetCollection) {
          targetCollection = generateCollectionName(file.name);
          setUploadFiles((prev) =>
            prev.map((u) =>
              u.id === uploadId
                ? { ...u, statusText: `Creating collection "${targetCollection}"…` }
                : u
            )
          );
          await createCollection({
            collectionName: targetCollection,
            ttEmbeddingModel: modelIdentifier,
          });
          setSelectedCollection(targetCollection);
        }

        setUploadFiles((prev) =>
          prev.map((u) =>
            u.id === uploadId
              ? { ...u, progress: 60, statusText: "Chunking & generating embeddings…" }
              : u
          )
        );
        await uploadDocument({ file, collectionName: targetCollection });

        setUploadFiles((prev) =>
          prev.map((u) =>
            u.id === uploadId
              ? { ...u, status: "success", progress: 100, statusText: "Embedded" }
              : u
          )
        );

        await loadCollections();
        const docs = await fetchDocuments(targetCollection);
        setDocuments(docs.documents || []);
      } catch (err) {
        setUploadFiles((prev) =>
          prev.map((u) =>
            u.id === uploadId
              ? {
                  ...u,
                  status: "error",
                  errorMessage:
                    err instanceof Error ? err.message : "Upload failed",
                }
              : u
          )
        );
      }
    }
  };

  const handleQuery = async () => {
    if (!selectedCollection || !queryText.trim()) return;
    setIsQuerying(true);
    setQueryResults(null);
    try {
      const result = await queryCollection(selectedCollection, queryText.trim());
      setQueryResults(result);
    } catch (err) {
      customToast.error(
        `Search failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsQuerying(false);
    }
  };

  const handleDeleteCollection = async () => {
    if (!selectedCollection) return;
    setIsDeleting(true);
    try {
      await deleteCollection({ collectionName: selectedCollection });
      customToast.success(`Deleted collection "${selectedCollection}"`);
      setSelectedCollection("");
      setQueryResults(null);
      await loadCollections();
    } catch (err) {
      customToast.error(
        `Failed to delete collection: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const resultRows = queryResults?.documents?.[0] ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Collection selector */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Collection
        </label>
        <div className="flex gap-2">
          <Select
            value={selectedCollection || "__new__"}
            onValueChange={(v) => setSelectedCollection(v === "__new__" ? "" : v)}
            disabled={loadingCollections}
          >
            <SelectTrigger className="h-11 text-base border-2 flex-1">
              <SelectValue placeholder="Select a collection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__new__">
                + New collection (named from first upload)
              </SelectItem>
              {collections.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedCollection && (
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              onClick={handleDeleteCollection}
              disabled={isDeleting}
              title="Delete this collection"
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Locked to this model's vector space -- only collections created with it
          appear here.
        </p>
      </div>

      {/* Upload */}
      <GentleFileUpload files={uploadFiles} onChange={handleFilesSelected} />

      {/* Document list */}
      {selectedCollection && documents.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            Documents in "{selectedCollection}"
          </label>
          <div className="flex flex-col gap-1.5 max-h-40 overflow-auto">
            {documents.map((doc) => (
              <div
                key={doc.filename}
                className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
              >
                <FileText className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                <span className="truncate flex-1">{doc.filename}</span>
                <span className="text-xs text-gray-500 shrink-0">
                  {doc.chunks_count} chunk{doc.chunks_count === 1 ? "" : "s"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      {selectedCollection && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            Search this collection
          </label>
          <div className="flex gap-2">
            <Input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleQuery()}
              placeholder="Ask something about the uploaded documents…"
              className="h-11 text-base border-2"
              disabled={isQuerying}
            />
            <Button
              className="h-11 px-5 bg-TT-purple-accent hover:bg-TT-purple text-white shrink-0"
              onClick={handleQuery}
              disabled={isQuerying || !queryText.trim()}
            >
              {isQuerying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </Button>
          </div>

          {queryResults && (
            <div className="flex flex-col gap-2 mt-1 max-h-72 overflow-auto">
              {resultRows.length === 0 ? (
                <p className="text-sm text-gray-500">No matches found.</p>
              ) : (
                resultRows.map((doc, i) => (
                  <div
                    key={queryResults.ids[0][i]}
                    className="rounded-lg border border-[#7C68FA]/30 p-3"
                    style={{ background: "#0D0D14" }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-[#2EE8C4]">
                        {(queryResults.metadatas[0][i]?.source as string) ||
                          "chunk"}
                      </span>
                      <span className="text-xs font-mono text-gray-500">
                        distance {queryResults.distances[0][i].toFixed(4)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 line-clamp-3">{doc}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
