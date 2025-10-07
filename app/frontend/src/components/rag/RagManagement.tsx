// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { Button } from "@/src/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/src/components/ui/card";
import { ScrollArea, ScrollBar } from "@/src/components/ui/scroll-area";

import CopyableText from "@/src/components/CopyableText";
import { useTheme } from "@/src/hooks/useTheme";
import CustomToaster, { customToast } from "@/src/components/CustomToaster";
import React, { useRef, useState, useEffect } from "react";
import { ConfirmDialog } from "@/src/components/ConfirmDialog";
import {
  fetchCollections,
  deleteCollection,
  createCollection,
  uploadDocument,
  fetchDocuments,
} from "@/src/components/rag";
import {
  FileType,
  Trash2,
  Upload,
  Fingerprint,
  User,
  Settings,
  ChevronDown,
  ChevronUp,
  Database,
} from "lucide-react";
import { GentleFileUpload } from "@/src/components/ui/gentle-file-upload";
import { RagManagementSkeleton } from "@/src/components/rag/RagSkeletons";
import { v4 as uuidv4 } from "uuid";
import type { JSX } from "react";

// Spinner component with size variants
type SpinnerProps = {
  size?: "sm" | "md" | "lg";
};

const Spinner = ({ size = "md" }: SpinnerProps): JSX.Element => {
  const sizeClasses = {
    sm: "h-3 w-3",
    md: "h-5 w-5",
    lg: "h-8 w-8",
  };

  return (
    <div
      className={`animate-spin rounded-full border-2 border-current border-t-transparent text-primary-foreground dark:text-primary-dark-foreground ${sizeClasses[size]}`}
      aria-label="loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-state="loading"
      data-testid="spinner-component"
    >
      <span className="sr-only">Loading</span>
    </div>
  );
};

// LocalStorage key for browser ID
const BROWSER_ID_KEY = "tt_studio_browser_id";

// Get browser ID from localStorage or create a new one
const getBrowserId = (): string => {
  let browserId = localStorage.getItem(BROWSER_ID_KEY);

  if (!browserId) {
    browserId = uuidv4();
    localStorage.setItem(BROWSER_ID_KEY, browserId);
  }

  return browserId;
};

// Add browser ID to headers for all fetch requests
const originalFetch = window.fetch;
window.fetch = function (
  input: string | URL | Request,
  init?: globalThis.RequestInit
): Promise<Response> {
  // Create new options object to avoid mutating the original
  const newInit: globalThis.RequestInit = { ...(init || {}) };

  // Initialize headers if not present
  newInit.headers = newInit.headers || {};

  // Add browser ID header to all requests
  newInit.headers = {
    ...newInit.headers,
    "X-Browser-ID": getBrowserId(),
  };

  return originalFetch(input, newInit);
};

interface RagDataSource {
  id: string;
  name: string;
  metadata: Record<string, string>;
  documents?: DocumentInfo[];
  total_files?: number;
}

interface DocumentInfo {
  filename: string;
  folder_type: string;
  folder_path: string;
  file_extension: string;
  display_path: string;
  chunks_count: number;
  upload_date: string;
}

const TableWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="h-screen flex-1 w-full dark:bg-black bg-white dark:bg-dot-white/[0.2] bg-dot-black/[0.2] relative flex items-center justify-center">
      <div
        className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
        style={{
          maskImage:
            "radial-gradient(ellipse at center, transparent 20%, black 100%)",
        }}
      ></div>
      <div className="flex flex-col h-screen w-full px-4 md:px-20 pt-8 md:pt-8 pb-16 md:pb-28 overflow-hidden mt-8">
        {children}
      </div>
    </div>
  );
};

export default function RagManagement() {
  const inputFile = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Explicitly manage loading state separate from react-query
  const [loading, setLoading] = useState(true);
  const [ragDataSources, setRagDataSources] = useState<RagDataSource[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const [collectionsUploading, setCollectionsUploading] = useState<string[]>(
    []
  );
  const [isDragging, setIsDragging] = useState(false);

  // State to track expanded rows
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const { theme } = useTheme();

  // Toggle expanded row
  const toggleExpandRow = (id: string) => {
    setExpandedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Ensure browser ID is initialized on component mount
  useEffect(() => {
    // This just makes sure browser ID is initialized
    getBrowserId();
  }, []);

  // Load data effect similar to ModelsDeployedTable approach
  useEffect(() => {
    const loadCollections = async () => {
      setLoading(true);
      try {
        // Add delay to simulate network latency (for testing only)
        await new Promise((resolve) => setTimeout(resolve, 300));

        const collections = await fetchCollections();
        console.log("[RagManagement] Fetched collections:", collections);

        // Fetch documents for each collection
        const collectionsWithDocuments = await Promise.allSettled(
          collections.map(async (collection: RagDataSource) => {
            try {
              const documentsData = await fetchDocuments(collection.name);
              return {
                ...collection,
                documents: documentsData.documents || [],
                total_files: documentsData.total_files || 0,
              };
            } catch (error) {
              console.error(
                `Error fetching documents for ${collection.name}:`,
                error
              );
              // Return collection without documents if fetch fails
              return {
                ...collection,
                documents: [],
                total_files: 0,
              };
            }
          })
        );

        // Process the results
        const finalCollections = collectionsWithDocuments
          .map((result) => {
            if (result.status === "fulfilled") {
              return result.value;
            } else {
              console.error("Failed to process collection:", result.reason);
              return null;
            }
          })
          .filter(Boolean); // Remove null values

        console.log(
          "[RagManagement] Collections with documents:",
          finalCollections
        );

        // Debug: Log information about internal knowledge detection
        console.log(
          "[RagManagement] Collection analysis:",
          finalCollections.map((col) => ({
            name: col.name,
            id: col.id,
            documentsCount: col.documents?.length || 0,
            hasMetadata: Boolean(col.metadata),
            lastUploadedDoc: col.metadata?.last_uploaded_document,
            isInternalKnowledge:
              col.documents?.length === 0 &&
              !col.metadata?.last_uploaded_document,
          }))
        );

        setRagDataSources(finalCollections as RagDataSource[]);
      } catch (err) {
        setError(err as Error);
        customToast.error("Failed to fetch collections");
      } finally {
        setLoading(false);
      }
    };

    loadCollections();
  }, []);

  // Auto-create collection and upload document
  const autoCreateAndUploadMutation = useMutation({
    mutationFn: async ({
      file,
      collectionName,
    }: {
      file: File;
      collectionName: string;
    }) => {
      // First create the collection
      await createCollection({ collectionName });

      // Then upload the document
      await uploadDocument({ file, collectionName });

      return { file, collectionName };
    },
    onMutate: ({ collectionName }) => {
      setCollectionsUploading([...collectionsUploading, collectionName]);
      customToast.success(
        `Creating datasource "${collectionName}" and uploading document...`
      );
    },
    onError: (error: any, { file, collectionName }) => {
      setCollectionsUploading(
        collectionsUploading.filter((e) => e !== collectionName)
      );
      if (error.message === "Collection name already exists") {
        customToast.error(
          `Collection "${collectionName}" already exists. Please choose a different name.`
        );
      } else {
        customToast.error(
          `Error creating datasource and uploading ${file.name}: ${error.message}`
        );
      }
    },
    onSuccess: async ({ file, collectionName }) => {
      setCollectionsUploading(
        collectionsUploading.filter((e) => e !== collectionName)
      );
      customToast.success(
        `Successfully created datasource "${collectionName}" and uploaded "${file.name}"`
      );

      // Add a delay to allow backend to process the upload and update metadata
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Refresh the data with retry logic
      setLoading(true);
      try {
        let retries = 3;
        let data: RagDataSource[] = [];

        while (retries > 0) {
          const collections = await fetchCollections();

          // Fetch documents for each collection
          const collectionsWithDocuments = await Promise.allSettled(
            collections.map(async (collection: RagDataSource) => {
              try {
                const documentsData = await fetchDocuments(collection.name);
                return {
                  ...collection,
                  documents: documentsData.documents || [],
                  total_files: documentsData.total_files || 0,
                };
              } catch (error) {
                console.error(
                  `Error fetching documents for ${collection.name}:`,
                  error
                );
                return {
                  ...collection,
                  documents: [],
                  total_files: 0,
                };
              }
            })
          );

          data = collectionsWithDocuments
            .map((result) => {
              if (result.status === "fulfilled") {
                return result.value;
              } else {
                console.error("Failed to process collection:", result.reason);
                return null;
              }
            })
            .filter(Boolean) as RagDataSource[];

          // Check if the collection we just created has the uploaded document
          const newCollection = data.find(
            (col: RagDataSource) => col.name === collectionName
          );
          console.log(
            `[AutoUpload] Checking collection "${collectionName}":`,
            newCollection
          );
          console.log(
            `[AutoUpload] Expected file: "${file.name}", Found documents:`,
            newCollection?.documents
          );

          if (
            newCollection &&
            newCollection.documents &&
            newCollection.documents.some((doc) => doc.filename === file.name)
          ) {
            // Document is uploaded and found, we're good
            console.log(
              `[AutoUpload] Document found for ${collectionName}: ${file.name}`
            );
            break;
          }

          // If not updated yet, wait a bit more and retry
          if (retries > 1) {
            console.log(
              `[AutoUpload] Document not found, retrying... (${retries - 1} retries left)`
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
          } else {
            console.warn(
              `[AutoUpload] Document update failed after all retries for ${collectionName}`
            );
            // Show a warning but still show the collection
          }
          retries--;
        }

        setRagDataSources(data);
      } catch (err) {
        console.error("Error fetching collections:", err);
      } finally {
        setLoading(false);
      }
    },
  });

  // Delete collection mutation
  const deleteCollectionMutation = useMutation({
    mutationFn: deleteCollection,
    onError(error: Error, variables: { collectionName: string }) {
      customToast.error(
        `Error deleting ${variables.collectionName}: ${error.message}`
      );
    },
    onSuccess: (_data, variables: { collectionName: string }) => {
      queryClient.invalidateQueries({ queryKey: ["collectionsList"] });

      // Update local state
      setRagDataSources((prev) =>
        prev.filter((rds) => rds.name !== variables.collectionName)
      );

      customToast.success("Collection deleted successfully");
      customToast.success(`Deleted collection ${variables.collectionName}`);
    },
  });

  // Upload document mutation (for existing collections)
  const uploadDocumentMutation = useMutation({
    mutationFn: uploadDocument,
    onMutate: ({ collectionName }) => {
      setCollectionsUploading([...collectionsUploading, collectionName]);
      customToast.success("Uploading document...");
    },
    onError: (_error, { file, collectionName }) => {
      customToast.error(`Error uploading ${file.name} to ${collectionName}`);
    },
    onSuccess: async (response, { file, collectionName }) => {
      setCollectionsUploading(
        collectionsUploading.filter((e) => e !== collectionName)
      );

      // Check if metadata was updated successfully
      const uploadResponse = response.data;
      if (uploadResponse?.metadata_updated === false) {
        customToast.warning(
          `Uploaded ${file.name} to ${collectionName}, but file name may not display correctly`
        );
        console.warn(
          `[UploadExisting] Metadata update failed for ${collectionName}:`,
          uploadResponse
        );
      } else {
        customToast.success(`Uploaded ${file.name} to ${collectionName}`);
      }

      // Log the response for debugging
      console.log(`[UploadExisting] Upload response:`, uploadResponse);

      // Add a delay to allow backend to process the upload and update metadata
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Refresh the data with retry logic
      setLoading(true);
      try {
        let retries = 3;
        let data: RagDataSource[] = [];

        while (retries > 0) {
          const collections = await fetchCollections();

          // Fetch documents for each collection
          const collectionsWithDocuments = await Promise.allSettled(
            collections.map(async (collection: RagDataSource) => {
              try {
                const documentsData = await fetchDocuments(collection.name);
                return {
                  ...collection,
                  documents: documentsData.documents || [],
                  total_files: documentsData.total_files || 0,
                };
              } catch (error) {
                console.error(
                  `Error fetching documents for ${collection.name}:`,
                  error
                );
                return {
                  ...collection,
                  documents: [],
                  total_files: 0,
                };
              }
            })
          );

          data = collectionsWithDocuments
            .map((result) => {
              if (result.status === "fulfilled") {
                return result.value;
              } else {
                console.error("Failed to process collection:", result.reason);
                return null;
              }
            })
            .filter(Boolean) as RagDataSource[];

          // Check if the collection has the uploaded document
          const updatedCollection = data.find(
            (col: RagDataSource) => col.name === collectionName
          );
          console.log(
            `[UploadExisting] Checking collection "${collectionName}":`,
            updatedCollection
          );
          console.log(
            `[UploadExisting] Expected file: "${file.name}", Found documents:`,
            updatedCollection?.documents
          );

          if (
            updatedCollection &&
            updatedCollection.documents &&
            updatedCollection.documents.some(
              (doc) => doc.filename === file.name
            )
          ) {
            // Document is uploaded and found, we're good
            console.log(
              `[UploadExisting] Document found for ${collectionName}: ${file.name}`
            );
            break;
          }

          // If not updated yet, wait a bit more and retry
          if (retries > 1) {
            console.log(
              `[UploadExisting] Document not found yet, retrying... (${retries - 1} retries left)`
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
          } else {
            console.warn(
              `[UploadExisting] Document update failed after all retries for ${collectionName}`
            );
          }
          retries--;
        }

        setRagDataSources(data);
      } catch (err) {
        console.error("Error fetching collections:", err);
      } finally {
        setLoading(false);
      }
    },
  });

  // Generate collection name from file name
  const generateCollectionName = (fileName: string): string => {
    // Remove extension and special characters, replace spaces with underscores
    return fileName
      .replace(/\.[^/.]+$/, "") // Remove file extension
      .replace(/[^a-zA-Z0-9_-]/g, "_") // Replace special chars with underscores
      .replace(/_{2,}/g, "_") // Replace multiple underscores with single
      .replace(/^_|_$/g, "") // Remove leading/trailing underscores
      .toLowerCase();
  };

  // Handle file drop
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    handleFileUpload(files);
  };

  // Handle file selection
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const files = Array.from(e.target.files);
    handleFileUpload(files);

    // Reset input
    e.target.value = "";
  };

  // Handle file upload
  const handleFileUpload = (files: File[]) => {
    files.forEach((file) => {
      const collectionName = generateCollectionName(file.name);

      if (collectionName.length < 2) {
        customToast.error(
          `Generated collection name "${collectionName}" is too short. Please rename the file.`
        );
        return;
      }

      // Check if collection already exists
      const existingCollection = ragDataSources.find(
        (rds) => rds.name === collectionName
      );
      if (existingCollection) {
        // Upload to existing collection
        uploadDocumentMutation.mutate({ file, collectionName });
      } else {
        // Create new collection and upload
        autoCreateAndUploadMutation.mutate({ file, collectionName });
      }
    });
  };

  // Drag handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  // Show skeleton while loading
  if (loading) {
    return <RagManagementSkeleton />;
  }

  if (error) {
    return (
      <TableWrapper>
        <Card
          className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg p-8`}
        >
          <div className="text-red-600 dark:text-red-400">
            Error loading collections: {error.message}
          </div>
        </Card>
      </TableWrapper>
    );
  }

  // Helper function to check if a collection contains only internal knowledge
  const isInternalKnowledgeCollection = (item: RagDataSource): boolean => {
    // Check if collection has no user-uploaded documents AND exists (indicating it contains internal knowledge)
    const hasNoUserDocs = !item.documents || item.documents.length === 0;
    const hasValidId = Boolean(item.id);
    const hasValidName = Boolean(item.name);

    // Additional check: if metadata doesn't contain last_uploaded_document, it's likely internal only
    const hasNoUploadedDocumentMetadata =
      !item.metadata?.last_uploaded_document;

    // Check if this is the system-created internal knowledge collection
    const isSystemInternalCollection =
      item.metadata?.type === "internal_knowledge" ||
      item.metadata?.created_by === "system" ||
      item.name === "tenstorrent_internal_knowledge";

    // A collection is internal knowledge if:
    // 1. It's the system-created internal knowledge collection OR
    // 2. It has no user documents AND valid ID/name AND no uploaded document metadata
    const isInternal =
      isSystemInternalCollection ||
      (hasNoUserDocs &&
        hasValidId &&
        hasValidName &&
        hasNoUploadedDocumentMetadata);

    // Debug logging
    console.log(`[isInternalKnowledgeCollection] ${item.name}:`, {
      hasNoUserDocs,
      hasValidId,
      hasValidName,
      hasNoUploadedDocumentMetadata,
      isSystemInternalCollection,
      isInternal,
      metadata: item.metadata,
      documents: item.documents,
    });

    return isInternal;
  };

  // Action buttons component for reuse
  const ActionButtons = ({
    item,
    isUploading,
    onDelete,
    onUploadClick,
  }: {
    item: RagDataSource;
    isUploading?: boolean;
    onDelete: (rds: RagDataSource) => void;
    onUploadClick: (rds: RagDataSource) => void;
  }) => {
    const isInternal = isInternalKnowledgeCollection(item);

    return (
      <div className="flex flex-wrap gap-1 justify-end">
        {isInternal ? (
          // Show disabled buttons for internal knowledge collections with tooltips
          <div className="flex gap-1">
            <Button
              disabled={true}
              className="bg-gray-400 dark:bg-gray-600 text-gray-700 dark:text-gray-400 cursor-not-allowed rounded-lg flex items-center gap-1 px-2 py-1 h-auto min-h-8"
              title="Cannot delete internal knowledge collections"
            >
              <Trash2 className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline ml-1">Delete</span>
            </Button>
            <Button
              disabled={true}
              className="bg-gray-400 dark:bg-gray-600 text-gray-700 dark:text-gray-400 cursor-not-allowed rounded-lg flex items-center gap-1 px-2 py-1 h-auto min-h-8"
              title="Cannot upload to internal knowledge collections"
            >
              <Upload className="w-3 h-3 md:w-4 md:h-4" />
              <span className="hidden sm:inline ml-1">Upload</span>
            </Button>
            <div className="flex items-center px-2 py-1">
              <span className="text-xs text-gray-500 dark:text-gray-400 italic">
                Internal Knowledge
              </span>
            </div>
          </div>
        ) : (
          // Show normal buttons for user collections
          <>
            <ConfirmDialog
              dialogDescription="This action cannot be undone. This will permanently delete the datasource and all associated files."
              dialogTitle="Delete Datasource"
              onConfirm={() => onDelete(item)}
              alertTrigger={
                <Button
                  disabled={isUploading}
                  className="bg-red-700 dark:bg-red-600 hover:bg-red-500 dark:hover:bg-red-500 text-white rounded-lg flex items-center gap-1 px-2 py-1 h-auto min-h-8 transition-all duration-200 ease-in-out hover:scale-105 hover:shadow-md active:scale-95"
                >
                  <Trash2 className="w-3 h-3 md:w-4 md:h-4 transition-transform duration-200 hover:rotate-12" />
                  <span className="hidden sm:inline ml-1">Delete</span>
                </Button>
              }
            />
            <ConfirmDialog
              dialogDescription={
                item.documents && item.documents.length > 0
                  ? `This collection already has ${item.documents.length} document${item.documents.length > 1 ? "s" : ""}. Adding a new document will append it to the collection. Are you sure?`
                  : "Select a document to upload to this collection. Supported types: PDF, TXT, DOCX, MD, HTML, and source code files."
              }
              dialogTitle={
                item.documents && item.documents.length > 0
                  ? "Add to existing documents?"
                  : "Upload Document"
              }
              onConfirm={() => onUploadClick(item)}
              alertTrigger={
                <Button
                  disabled={isUploading}
                  className="bg-blue-500 dark:bg-blue-700 hover:bg-blue-600 dark:hover:bg-blue-600 text-white rounded-lg flex items-center gap-1 px-2 py-1 h-auto min-h-8 transition-all duration-200 ease-in-out hover:scale-105 hover:shadow-md active:scale-95"
                  data-testid="upload-document-button"
                >
                  <Upload className="w-3 h-3 md:w-4 md:h-4 transition-transform duration-200 hover:-translate-y-1" />
                  <span className="hidden sm:inline ml-1">Upload</span>
                </Button>
              }
            />
            {isUploading && (
              <div className="my-auto">
                <Spinner size="sm" />
              </div>
            )}
          </>
        )}
      </div>
    );
  };
  // Render row with expandable content
  const renderRow = ({
    item,
    isUploading,
    onDelete,
    onUploadClick,
  }: {
    item: RagDataSource;
    isUploading?: boolean;
    onDelete: (rds: RagDataSource) => void;
    onUploadClick: (rds: RagDataSource) => void;
  }) => {
    const isExpanded = expandedRows[item.id] || false;

    return (
      <>
        <div className="cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800 group transition-all duration-200 ease-in-out hover:shadow-md py-3">
          <div className="grid grid-cols-12 gap-4 items-center">
            {/* Expand/Collapse Button */}
            <div className="col-span-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 transition-all duration-200 ease-in-out hover:scale-110 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                onClick={() => toggleExpandRow(item.id)}
              >
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 transition-transform duration-200" />
                ) : (
                  <ChevronDown className="h-4 w-4 transition-transform duration-200" />
                )}
              </Button>
            </div>

            {/* Name column */}
            <div
              className="col-span-4 md:col-span-3 cursor-pointer"
              onClick={() => toggleExpandRow(item.id)}
            >
              <div className="flex items-center gap-2">
                {isInternalKnowledgeCollection(item) ? (
                  <Database className="w-4 h-4 shrink-0 text-blue-500" />
                ) : (
                  <User className="w-4 h-4 shrink-0" />
                )}
                <span className="truncate font-medium">{item.name}</span>
                {isInternalKnowledgeCollection(item) && (
                  <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full ml-2">
                    Internal
                  </span>
                )}
              </div>
              {/* Documents info visible on mobile - below the name */}
              <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 dark:text-gray-400 sm:hidden">
                {item.documents && item.documents.length > 0 ? (
                  <>
                    <FileType className="w-3 h-3 shrink-0 text-blue-500" />
                    <span className="truncate">
                      {item.documents.length} file
                      {item.documents.length > 1 ? "s" : ""}
                      {item.documents.length === 1 &&
                        `: ${item.documents[0].filename}`}
                    </span>
                  </>
                ) : (
                  <>
                    <FileType className="w-3 h-3 shrink-0 text-gray-400 opacity-50" />
                    <span className="truncate italic">No files</span>
                  </>
                )}
              </div>
            </div>

            {/* Documents column - hidden on smallest screens */}
            <div
              className="hidden sm:block col-span-4 md:col-span-5 cursor-pointer"
              onClick={() => toggleExpandRow(item.id)}
            >
              {item.documents && item.documents.length > 0 ? (
                <div className="flex items-center gap-2">
                  <FileType color="blue" className="w-4 h-4 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {item.documents.length} file
                      {item.documents.length > 1 ? "s" : ""}
                    </span>
                    {item.documents.length === 1 && (
                      <span className="text-xs text-gray-500 truncate">
                        {item.documents[0].filename}
                      </span>
                    )}
                    {item.documents.length > 1 && (
                      <span className="text-xs text-gray-500">
                        {item.documents[0].filename}
                        {item.documents.length > 1 &&
                          ` +${item.documents.length - 1} more`}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <FileType
                    color="gray"
                    className="w-4 h-4 shrink-0 opacity-50"
                  />
                  <span className="text-gray-500 italic">No files</span>
                </div>
              )}
            </div>

            {/* Actions column */}
            <div className="col-span-7 sm:col-span-3 md:col-span-3 flex justify-end">
              <ActionButtons
                item={item}
                isUploading={isUploading}
                onDelete={onDelete}
                onUploadClick={onUploadClick}
              />
            </div>
          </div>
        </div>

        {/* Expandable content with additional details */}
        {isExpanded && (
          <div className="bg-gray-50 dark:bg-zinc-800 animate-in slide-in-from-top-2 duration-300 px-4 py-4 mx-4 rounded-md mb-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex flex-col">
                <span className="font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <Fingerprint className="w-3 h-3" /> ID
                </span>
                <div className="mt-1">
                  <CopyableText text={item.id} />
                </div>
              </div>

              {/* Documents info display - always present in expanded view */}
              <div className="flex flex-col md:col-span-2">
                <span className="font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <FileType className="w-3 h-3" /> Uploaded Documents (
                  {item.documents?.length || 0})
                </span>
                <div className="mt-2 space-y-2">
                  {item.documents && item.documents.length > 0 ? (
                    item.documents.map((doc, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded-md transition-all duration-200 ease-in-out hover:bg-gray-100 dark:hover:bg-gray-700 hover:shadow-sm hover:scale-[1.01]"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <FileType className="w-4 h-4 shrink-0 text-blue-500" />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-sm font-medium truncate">
                              {doc.filename}
                            </span>
                            <div className="text-xs text-gray-500 flex gap-2">
                              <span>{doc.folder_type}</span>
                              <span>•</span>
                              <span>{doc.chunks_count} chunks</span>
                              <span>•</span>
                              <span>
                                {new Date(doc.upload_date).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0">
                          <CopyableText text={doc.filename} />
                        </div>
                      </div>
                    ))
                  ) : (
                    <span className="text-gray-500 italic text-sm">
                      No documents uploaded
                    </span>
                  )}
                </div>
              </div>

              {/* Additional metadata displayed here */}
              {Object.entries(item.metadata || {})
                .filter(([key]) => key !== "last_uploaded_document")
                .map(([key, value]) => (
                  <div key={key} className="flex flex-col">
                    <span className="font-medium text-gray-500 dark:text-gray-400">
                      {key}
                    </span>
                    <span>{value}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </>
    );
  };

  // Add a log before rendering
  console.log("[RagManagement] ragDataSources before render:", ragDataSources);

  return (
    <>
      <TableWrapper>
        {/* Hidden file input */}
        <input
          type="file"
          onChange={handleFileInput}
          accept=".pdf,.txt,.docx,.doc,.md,.html,.py,.js,.ts,.tsx,.jsx,.json,.xml,.yaml,.yml,.csv,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/markdown,text/html,application/json,text/xml,text/csv"
          multiple
          ref={inputFile}
          style={{ display: "none" }}
        />

        {/* File Upload Area */}
        <Card
          className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg mb-4 transition-all duration-300 ease-in-out hover:shadow-lg hover:scale-[1.01] ${
            isDragging
              ? "border-TT-purple-accent bg-TT-purple-tint2 dark:bg-TT-purple-accent/20 shadow-lg"
              : "hover:border-TT-purple-accent dark:hover:border-TT-purple-accent"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <GentleFileUpload onChange={handleFileUpload} />
        </Card>

        <Card
          className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg overflow-hidden`}
        >
          <CustomToaster />
          {/* Fixed Header */}
          <div
            className={`sticky top-0 z-20 ${theme === "dark" ? "bg-zinc-900" : "bg-white"} border-b border-gray-200 dark:border-gray-700`}
          >
            <div className="text-TT-black dark:text-TT-white text-lg md:text-xl text-center py-4 font-semibold">
              Manage RAG Datasources
              {ragDataSources.length > 3 && (
                <div className="text-xs font-normal text-gray-500 dark:text-gray-400 mt-1 flex items-center justify-center gap-1">
                  <span>
                    Scroll to view all {ragDataSources.length} datasources
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"></div>
                    <div
                      className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    ></div>
                    <div
                      className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-4 pb-2">
              <div className="grid grid-cols-12 gap-4 items-center">
                <div className="col-span-1"></div>
                <div className="col-span-4 md:col-span-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                    <User className="w-4 h-4" />
                    <span>Name</span>
                  </div>
                </div>
                <div className="hidden sm:block col-span-4 md:col-span-5">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                    <FileType className="w-4 h-4" />
                    <span>Documents</span>
                  </div>
                </div>
                <div className="col-span-7 sm:col-span-3 md:col-span-3">
                  <div className="flex items-center justify-end gap-2 text-sm font-medium text-gray-600 dark:text-gray-400">
                    <Settings className="w-4 h-4" />
                    <span className="hidden sm:inline">Manage</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <ScrollArea className="h-[600px] w-full">
            <div className="min-w-full px-4 pb-6">
              {Array.isArray(ragDataSources) &&
                ragDataSources.map((rds: RagDataSource) => (
                  <div
                    key={rds.id}
                    className="border-b border-gray-200 dark:border-gray-700 last:border-b-0"
                  >
                    {renderRow({
                      item: rds,
                      isUploading: collectionsUploading.includes(rds.name),
                      onUploadClick: (rds: RagDataSource) => {
                        // Create a mock file input for single file upload to existing collection
                        const input = document.createElement("input");
                        input.type = "file";
                        input.multiple = false;
                        input.accept =
                          ".pdf,.txt,.docx,.doc,.md,.html,.py,.js,.ts,.tsx,.jsx,.json,.xml,.yaml,.yml,.csv,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/markdown,text/html,application/json,text/xml,text/csv";
                        input.onchange = (e) => {
                          const target = e.target as HTMLInputElement;
                          if (target.files && target.files[0]) {
                            uploadDocumentMutation.mutate({
                              file: target.files[0],
                              collectionName: rds.name,
                            });
                          }
                        };
                        input.click();
                      },
                      onDelete: (rds: RagDataSource) =>
                        deleteCollectionMutation.mutate({
                          collectionName: rds.name,
                        }),
                    })}
                  </div>
                ))}
            </div>
            <ScrollBar orientation="vertical" />
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </Card>
      </TableWrapper>
    </>
  );
}
