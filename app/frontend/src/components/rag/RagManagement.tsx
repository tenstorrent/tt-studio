// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { Button } from "@/src/components/ui/button";
import { useMutation, useQueryClient } from "react-query";
import { Card } from "@/src/components/ui/card";
import { ScrollArea, ScrollBar } from "@/src/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import CopyableText from "@/src/components/CopyableText";
import { useTheme } from "@/src/providers/ThemeProvider";
import CustomToaster, { customToast } from "@/src/components/CustomToaster";
import React, { useRef, useState, useEffect } from "react";
import { ConfirmDialog } from "@/src/components/ConfirmDialog";
import {
  fetchCollections,
  deleteCollection,
  createCollection,
  uploadDocument,
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
  Plus,
  Cloud,
} from "lucide-react";
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
}

const TableWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="h-screen flex-1 w-full dark:bg-black bg-white dark:bg-dot-white/[0.2] bg-dot-black/[0.2] relative flex items-center justify-center">
      <div
        className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
        style={{
          maskImage: "radial-gradient(ellipse at center, transparent 20%, black 100%)",
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

  const [collectionsUploading, setCollectionsUploading] = useState<string[]>([]);
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

        const data = await fetchCollections();
        console.log("[RagManagement] Fetched collections:", data);
        setRagDataSources(data);
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
    mutationFn: async ({ file, collectionName }: { file: File; collectionName: string }) => {
      // First create the collection
      await createCollection({ collectionName });

      // Then upload the document
      await uploadDocument({ file, collectionName });

      return { file, collectionName };
    },
    onMutate: ({ collectionName }) => {
      setCollectionsUploading([...collectionsUploading, collectionName]);
      customToast.success(`Creating datasource "${collectionName}" and uploading document...`);
    },
    onError: (error: any, { file, collectionName }) => {
      setCollectionsUploading(collectionsUploading.filter((e) => e !== collectionName));
      if (error.message === "Collection name already exists") {
        customToast.error(
          `Collection "${collectionName}" already exists. Please choose a different name.`
        );
      } else {
        customToast.error(`Error creating datasource and uploading ${file.name}: ${error.message}`);
      }
    },
    onSuccess: async ({ file, collectionName }) => {
      setCollectionsUploading(collectionsUploading.filter((e) => e !== collectionName));
      customToast.success(
        `Successfully created datasource "${collectionName}" and uploaded "${file.name}"`
      );

      // Add a delay to allow backend to process the upload and update metadata
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Refresh the data with retry logic
      setLoading(true);
      try {
        let retries = 3;
        let data;

        while (retries > 0) {
          data = await fetchCollections();

          // Check if the collection we just created has the file metadata
          const newCollection = data.find((col: RagDataSource) => col.name === collectionName);
          console.log(`[AutoUpload] Checking collection "${collectionName}":`, newCollection);
          console.log(
            `[AutoUpload] Expected file: "${file.name}", Found metadata:`,
            newCollection?.metadata
          );

          if (newCollection && newCollection.metadata?.last_uploaded_document) {
            // Metadata is updated, we're good
            console.log(
              `[AutoUpload] Metadata found for ${collectionName}: ${newCollection.metadata.last_uploaded_document}`
            );
            break;
          }

          // If not updated yet, wait a bit more and retry
          if (retries > 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
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
      customToast.error(`Error deleting ${variables.collectionName}: ${error.message}`);
    },
    onSuccess: (_data, variables: { collectionName: string }) => {
      queryClient.invalidateQueries(["collectionsList"]);

      // Update local state
      setRagDataSources((prev) => prev.filter((rds) => rds.name !== variables.collectionName));

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
    onSuccess: async (_data, { file, collectionName }) => {
      setCollectionsUploading(collectionsUploading.filter((e) => e !== collectionName));
      customToast.success(`Uploaded ${file.name} to ${collectionName}`);

      // Add a delay to allow backend to process the upload and update metadata
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Refresh the data with retry logic
      setLoading(true);
      try {
        let retries = 3;
        let data;

        while (retries > 0) {
          data = await fetchCollections();

          // Check if the collection has the updated file metadata
          const updatedCollection = data.find((col: RagDataSource) => col.name === collectionName);
          console.log(
            `[UploadExisting] Checking collection "${collectionName}":`,
            updatedCollection
          );
          console.log(
            `[UploadExisting] Expected file: "${file.name}", Found metadata:`,
            updatedCollection?.metadata
          );

          if (
            updatedCollection &&
            updatedCollection.metadata?.last_uploaded_document === file.name
          ) {
            // Metadata is updated with the new file, we're good
            console.log(
              `[UploadExisting] Metadata updated for ${collectionName}: ${updatedCollection.metadata.last_uploaded_document}`
            );
            break;
          }

          // If not updated yet, wait a bit more and retry
          if (retries > 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
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
      const existingCollection = ragDataSources.find((rds) => rds.name === collectionName);
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
  }) => (
    <div className="flex flex-wrap gap-1 justify-end">
      <ConfirmDialog
        dialogDescription="This action cannot be undone. This will permanently delete the datasource and all associated files."
        dialogTitle="Delete Datasource"
        onConfirm={() => onDelete(item)}
        alertTrigger={
          <Button
            disabled={isUploading}
            className="bg-red-700 dark:bg-red-600 hover:bg-red-500 dark:hover:bg-red-500 text-white rounded-lg flex items-center gap-1 px-2 py-1 h-auto min-h-8"
          >
            <Trash2 className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline ml-1">Delete</span>
          </Button>
        }
      />
      <ConfirmDialog
        dialogDescription={
          item.metadata?.last_uploaded_document
            ? `This will replace the existing document "${item.metadata.last_uploaded_document}" with the new one. Are you sure?`
            : "Select a document to upload to this collection. Supported types: PDF, TXT, DOCX, MD, HTML, and source code files."
        }
        dialogTitle={
          item.metadata?.last_uploaded_document ? "Replace existing document?" : "Upload Document"
        }
        onConfirm={() => onUploadClick(item)}
        alertTrigger={
          <Button
            disabled={isUploading}
            className="bg-blue-500 dark:bg-blue-700 hover:bg-blue-600 dark:hover:bg-blue-600 text-white rounded-lg flex items-center gap-1 px-2 py-1 h-auto min-h-8"
            data-testid="upload-document-button"
          >
            <Upload className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline ml-1">Upload</span>
          </Button>
        }
      />
      {isUploading && (
        <div className="my-auto">
          <Spinner size="sm" />
        </div>
      )}
    </div>
  );
  // Render table row with expandable content
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
        <TableRow className="cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800 group">
          {/* Expand/Collapse Button */}
          <TableCell className="w-8 p-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => toggleExpandRow(item.id)}
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </TableCell>
          {/* Name column - always visible */}
          <TableCell
            className="font-medium text-left truncate max-w-[10rem] md:max-w-xs"
            onClick={() => toggleExpandRow(item.id)}
          >
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{item.name}</span>
            </div>
            {/* File name visible on mobile - below the name */}
            {item.metadata?.last_uploaded_document && (
              <div className="flex items-center gap-1 mt-1 text-xs text-gray-500 dark:text-gray-400 sm:hidden">
                <FileType className="w-3 h-3 flex-shrink-0 text-red-500" />
                <span className="truncate">{item.metadata.last_uploaded_document}</span>
              </div>
            )}
          </TableCell>
          {/* File name column - hidden on smallest screens */}
          <TableCell
            className="text-left hidden sm:table-cell truncate max-w-[10rem] md:max-w-xs"
            onClick={() => toggleExpandRow(item.id)}
          >
            {item.metadata?.last_uploaded_document ? (
              <div className="flex items-center gap-2">
                <FileType color="red" className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{item.metadata.last_uploaded_document}</span>
              </div>
            ) : (
              "No file uploaded"
            )}
          </TableCell>
          {/* Actions column */}
          <TableCell className="text-right">
            <ActionButtons
              item={item}
              isUploading={isUploading}
              onDelete={onDelete}
              onUploadClick={onUploadClick}
            />
          </TableCell>
        </TableRow>

        {/* Expandable row with additional details */}
        {isExpanded && (
          <TableRow className="bg-gray-50 dark:bg-zinc-800">
            <TableCell colSpan={4} className="p-2 md:p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <Fingerprint className="w-3 h-3" /> ID
                  </span>
                  <div className="mt-1">
                    <CopyableText text={item.id} />
                  </div>
                </div>

                {/* File info display - always present in expanded view */}
                <div className="flex flex-col">
                  <span className="font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    <FileType className="w-3 h-3" /> Complete Filename
                  </span>
                  <div className="mt-1">
                    {item.metadata?.last_uploaded_document ? (
                      <CopyableText text={item.metadata.last_uploaded_document} />
                    ) : (
                      "No file uploaded"
                    )}
                  </div>
                </div>

                {/* Additional metadata displayed here */}
                {Object.entries(item.metadata || {})
                  .filter(([key]) => key !== "last_uploaded_document")
                  .map(([key, value]) => (
                    <div key={key} className="flex flex-col">
                      <span className="font-medium text-gray-500 dark:text-gray-400">{key}</span>
                      <span>{value}</span>
                    </div>
                  ))}
              </div>
            </TableCell>
          </TableRow>
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
          className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg mb-4 ${
            isDragging ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : ""
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="p-8 text-center">
            <Cloud className="mx-auto h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium mb-2">Upload Documents to Create RAG Datasources</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Drag & drop files here or click to browse. Datasources will be created automatically
              using file names.
            </p>
            <Button
              onClick={() => inputFile.current?.click()}
              className="bg-blue-500 hover:bg-blue-600 text-white"
            >
              <Plus className="mr-2 h-4 w-4" />
              Select Files
            </Button>
          </div>
        </Card>

        <Card
          className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg overflow-hidden`}
        >
          <ScrollArea className="whitespace-nowrap rounded-md border w-full max-w-full p-2 sm:p-0">
            <CustomToaster />
            <div className="overflow-x-auto">
              <Table className="w-full">
                <TableCaption className="text-TT-black dark:text-TT-white text-lg md:text-xl">
                  Manage RAG Datasources
                </TableCaption>
                <TableHeader>
                  <TableRow className={theme === "dark" ? "bg-zinc-900" : "bg-zinc-200"}>
                    {/* Expand column */}
                    <TableHead className="w-8 p-2"></TableHead>
                    {/* Name column */}
                    <TableHead className="text-left">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4" />
                        <span>Name</span>
                      </div>
                    </TableHead>
                    {/* File name column - hidden on smallest screens */}
                    <TableHead className="text-left hidden sm:table-cell">
                      <div className="flex items-center gap-2">
                        <FileType className="w-4 h-4" />
                        <span>File Name</span>
                      </div>
                    </TableHead>
                    {/* Actions column */}
                    <TableHead className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Settings className="w-4 h-4" />
                        <span className="hidden sm:inline">Manage</span>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.isArray(ragDataSources) &&
                    ragDataSources.map((rds: RagDataSource) => (
                      <React.Fragment key={rds.id}>
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
                      </React.Fragment>
                    ))}
                </TableBody>
              </Table>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </Card>
      </TableWrapper>
    </>
  );
}
