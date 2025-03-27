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
import RagDataSourceForm from "./RagDataSourceForm";
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
} from "lucide-react";
import { RagManagementSkeleton } from "@/src/components/rag/RagSkeletons";

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
    browserId = crypto.randomUUID();
    localStorage.setItem(BROWSER_ID_KEY, browserId);
  }

  return browserId;
};

// Add browser ID to headers for all fetch requests
const originalFetch = window.fetch;
window.fetch = function (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // Create new options object to avoid mutating the original
  const newInit: RequestInit = { ...(init || {}) };

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

  const [targetCollection, setTargetCollection] = useState<
    RagDataSource | undefined
  >(undefined);

  const [collectionsUploading, setCollectionsUploading] = useState<string[]>(
    []
  );

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

  // Delete collection mutation
  const deleteCollectionMutation = useMutation({
    mutationFn: deleteCollection,
    onError(error: Error, variables: { collectionName: string }) {
      customToast.error(
        `Error deleting ${variables.collectionName}: ${error.message}`
      );
    },
    onSuccess: (_data, variables: { collectionName: string }) => {
      queryClient.invalidateQueries(["collectionsList"]);

      // Update local state
      setRagDataSources((prev) =>
        prev.filter((rds) => rds.name !== variables.collectionName)
      );

      customToast.success("Collection deleted successfully");
      customToast.success(`Deleted collection ${variables.collectionName}`);
    },
  });

  // Create collection
  const createCollectionMutation = useMutation({
    mutationFn: createCollection,
    onSuccess: async (_data, variables) => {
      customToast.success(
        `RAG Datasource created successfully: ${variables.collectionName}`
      );

      // Refresh the data
      setLoading(true);
      try {
        const data = await fetchCollections();
        setRagDataSources(data);
      } catch (err) {
        console.error("Error fetching collections:", err);
      } finally {
        setLoading(false);
      }
    },
    onError: (error: any) => {
      console.error("Error in createCollectionMutation:", error);
    },
  });

  // Upload document mutation
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
      setCollectionsUploading(
        collectionsUploading.filter((e) => e !== collectionName)
      );
      customToast.success(`Uploaded ${file.name} to ${collectionName}`);

      // Refresh the data
      setLoading(true);
      try {
        const data = await fetchCollections();
        setRagDataSources(data);
      } catch (err) {
        console.error("Error fetching collections:", err);
      } finally {
        setLoading(false);
      }
    },
    onSettled: () => {
      setTargetCollection(undefined);
    },
  });

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

  // Handle file selection for upload
  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !targetCollection) return;

    const file = e.target.files[0];
    uploadDocumentMutation.mutate({
      file,
      collectionName: targetCollection.name,
    });
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
            ? `This will replace the existing PDF "${item.metadata.last_uploaded_document}" with the new uploaded PDF. Are you sure you want to continue?`
            : "Select a PDF document to upload to this collection."
        }
        dialogTitle={
          item.metadata?.last_uploaded_document
            ? "Replace existing PDF?"
            : "Upload PDF"
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
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
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
                <span className="truncate">
                  {item.metadata.last_uploaded_document}
                </span>
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
                <span className="truncate">
                  {item.metadata.last_uploaded_document}
                </span>
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
                      <CopyableText
                        text={item.metadata.last_uploaded_document}
                      />
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
                      <span className="font-medium text-gray-500 dark:text-gray-400">
                        {key}
                      </span>
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

  return (
    <>
      <TableWrapper>
        {/* Hidden file input for uploads */}
        <input
          type="file"
          onChange={onFileSelected}
          accept="application/pdf"
          id="file"
          ref={inputFile}
          style={{ display: "none" }}
        />
        <Card
          className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg overflow-hidden mt-8 md:mt-0`}
        >
          <ScrollArea className="whitespace-nowrap rounded-md border w-full max-w-full p-2 sm:p-0">
            <CustomToaster />
            <RagDataSourceForm
              onSubmit={async (d) =>
                await createCollectionMutation.mutate({
                  collectionName: d.collectionName,
                })
              }
            />
            <div className="overflow-x-auto">
              <Table className="w-full">
                <TableCaption className="text-TT-black dark:text-TT-white text-lg md:text-xl">
                  Manage Rag Datasources
                </TableCaption>
                <TableHeader>
                  <TableRow
                    className={theme === "dark" ? "bg-zinc-900" : "bg-zinc-200"}
                  >
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
                  {ragDataSources.map((rds: RagDataSource) => (
                    <React.Fragment key={rds.id}>
                      {renderRow({
                        item: rds,
                        isUploading: collectionsUploading.includes(rds.name),
                        onUploadClick: (rds: RagDataSource) => {
                          setTargetCollection(rds);
                          inputFile.current?.click();
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
