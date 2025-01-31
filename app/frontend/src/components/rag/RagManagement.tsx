// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { Button } from "@/src/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "react-query";
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
import { useRef, useState } from "react";
import RagDataSourceForm from "./RagDataSourceForm";
import { Spinner } from "@/src/components/ui/spinner";
import { ConfirmDialog } from "@/src/components/ConfirmDialog";
import {
  fetchCollections,
  deleteCollection,
  createCollection,
  uploadDocument,
} from "@/src/components/rag";

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
      <div className="flex flex-col h-screen w-full md:px-20 pt-8 pb-28 overflow-hidden">
        {children}
      </div>
    </div>
  );
};

export default function RagManagement() {
  const inputFile = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const [targetCollection, setTargetCollection] = useState<
    RagDataSource | undefined
  >(undefined);

  const [collectionsUploading, setCollectionsUploading] = useState<string[]>(
    []
  );

  const { theme } = useTheme();

  // Fetch collections
  // TODO add, errors is loading etc
  const { data: ragDataSources } = useQuery("collectionsList", {
    queryFn: fetchCollections,
    onError: () => customToast.error("Failed to fetch collections"),
    initialData: [],
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
      queryClient.invalidateQueries(["collectionsList"]);
      customToast.success("Collection deleted successfully");
      customToast.success(`Deleted collection ${variables.collectionName}`);
    },
  });

  // Create collection
  const createCollectionMutation = useMutation({
    mutationFn: createCollection,
    onSuccess: (_data, variables) => {
      customToast.success(
        `Created new collection: ${variables.collectionName}`
      );
      queryClient.invalidateQueries(["collectionsList"]);
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
    onSuccess: (_data, { file, collectionName }) => {
      setCollectionsUploading(
        collectionsUploading.filter((e) => e !== collectionName)
      );
      customToast.success(`Uploaded ${file.name} to ${collectionName}`);
      queryClient.invalidateQueries(["collectionsList"]); // Refresh to update file name
    },
    onSettled: () => {
      setTargetCollection(undefined);
    },
  });

  // TODO Add loading screen
  // if (isLoading) {
  //  return <div>Loading</div>;
  // }

  // TODO Add error component
  // if (error) {
  //  return <div>Errors: {JSON.stringify(error)}</div>;
  // }

  // Handle file selection for upload
  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !targetCollection) return;

    const file = e.target.files[0];
    uploadDocumentMutation.mutate({
      file,
      collectionName: targetCollection.name,
    });
  };

  // Render table row with file name column
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
  }) => (
    <TableRow key={item.id}>
      <TableCell className="text-left">
        <CopyableText text={item.name} />
      </TableCell>
      <TableCell className="text-left">
        <CopyableText text={item.id} />
      </TableCell>
      <TableCell className="text-left">
        {item.metadata?.last_uploaded_document ? (
          <CopyableText text={item.metadata.last_uploaded_document} />
        ) : (
          "No file uploaded"
        )}
      </TableCell>
      <TableCell className="text-left">
        <div className="flex gap-1">
          <ConfirmDialog
            dialogDescription="This action cannot be undone. This will permanently delete the datasource."
            dialogTitle="Delete Datasource"
            onConfirm={() => onDelete(item)}
            alertTrigger={
              <Button
                disabled={isUploading}
                className="bg-red-700 dark:bg-red-600 hover:bg-red-500 dark:hover:bg-red-500 text-white rounded-lg"
              >
                Delete
              </Button>
            }
          />
          <Button
            disabled={isUploading}
            className="bg-blue-500 dark:bg-blue-700 hover:bg-blue-600 dark:hover:bg-blue-600 text-white rounded-lg"
            onClick={() => onUploadClick(item)}
          >
            Upload Document
          </Button>
          <div className={`my-auto ${!isUploading && "invisible"}`}>
            <Spinner />
          </div>
        </div>
      </TableCell>
    </TableRow>
  );

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
          className={`${theme === "dark" ? "bg-zinc-900 text-zinc-200" : "bg-white text-black border-gray-500"} border-2 rounded-lg`}
        >
          <ScrollArea className="whitespace-nowrap rounded-md border">
            <CustomToaster />
            <RagDataSourceForm
              onSubmit={(d) =>
                createCollectionMutation.mutate({
                  collectionName: d.collectionName,
                })
              }
            />
            <Table className="rounded-lg">
              <TableCaption className="text-TT-black dark:text-TT-white text-xl">
                Manage Rag Datasources
              </TableCaption>
              <TableHeader>
                <TableRow
                  className={theme === "dark" ? "bg-zinc-900" : "bg-zinc-200"}
                >
                  {["Name", "ID", "File Name", "Manage"].map((f) => (
                    <TableHead key={f} className="text-left">
                      {f}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ragDataSources.map((rds: RagDataSource) =>
                  renderRow({
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
                  })
                )}
              </TableBody>
            </Table>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </Card>
      </TableWrapper>
    </>
  );
}
