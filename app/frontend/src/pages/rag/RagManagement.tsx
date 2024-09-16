// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
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
} from "@/src/pages/rag";

interface RagDataSource {
  id: string;
  name: string;
  metadata: Record<string, string>;
}

const TableWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className=" h-screen flex-1 w-full dark:bg-black bg-white dark:bg-dot-white/[0.2] bg-dot-black/[0.2] relative flex items-center justify-center ">
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

  // Used to associate the hidden file input w/ the target collection
  const [targetCollection, setTargetCollection] = useState<
    RagDataSource | undefined
  >(undefined);

  // Track which collections are being uploaded to
  const [collectionsUploading, setCollectionsUploading] = useState<string[]>(
    []
  );

  const { theme } = useTheme();

  // Fetch collections
  const {
    data: ragDataSources,
    // error,
    // isLoading,
  } = useQuery("collectionsList", {
    queryFn: fetchCollections,
    onError: () => customToast.error("Failed to fetch collections"),
    initialData: [],
  });

  // Delete mutation
  const deleteCollectionMutation = useMutation({
    mutationFn: deleteCollection,
    onError(error: Error, variables: { collectionName: string }) {
      const { collectionName } = variables;
      customToast.error(`Error deleting ${collectionName}: ${error}`);
    },
    onSuccess: (_data, variables: { collectionName: string }) => {
      customToast.success(`Deleted collection ${variables.collectionName}`);
      queryClient.invalidateQueries(["collectionsList"]);
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

  // Upload to collection
  const { mutate: uploadDocumentMutate } = useMutation({
    mutationFn: uploadDocument,
    onMutate: ({ collectionName }) => {
      setCollectionsUploading([...collectionsUploading, collectionName]);
      customToast.success("Uploading document");
    },
    onError: (_error, { file, collectionName }) => {
      customToast.error(
        `Error uploading document ${file.name} to ${collectionName}`
      );
    },
    onSuccess: (_data, { file, collectionName }) => {
      setCollectionsUploading(
        collectionsUploading.filter((e) => e !== collectionName)
      );
      customToast.success(
        `Uploaded document ${file.name} to ${collectionName}`
      );
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

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !targetCollection) {
      return;
    }
    const file = e.target.files[0];
    uploadDocumentMutate({
      file,
      collectionName: targetCollection.name,
    });
  };

  const renderRow = ({
    theme,
    item,
    isUploading,
    onDelete,
    onUploadClick,
  }: {
    theme: string;
    isUploading?: boolean;
    item: RagDataSource;
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
        <div className="flex gap-1">
          <ConfirmDialog
            dialogDescription={
              "This action cannot be undone. This will permanently delete the data source"
            }
            dialogTitle={"Delete Data Source"}
            onConfirm={() => {
              onDelete(item);
            }}
            alertTrigger={
              <Button
                disabled={isUploading}
                className="bg-red-700 dark:bg-red-600 hover:bg-red-500 dark:hover:bg-red-500 text-white rounded-lg"
              >
                Delete
              </Button>
            }
          ></ConfirmDialog>
          <Button
            disabled={isUploading}
            className="bg-blue-500 dark:bg-blue-700 hover:bg-blue-600 dark:hover:bg-blue-600 text-white rounded-lg"
            onClick={() => onUploadClick(item)}
            className="bg-blue-500 dark:bg-blue-700 hover:bg-blue-600 dark:hover:bg-blue-600 text-white rounded-lg"
          >
            Upload Document
          </Button>

          <div className={`my-auto ${!isUploading && "invisible"}`}>
            <Spinner></Spinner>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <TableWrapper>
        {/* All rows share a single file input control */}
        <input
          type="file"
          onChange={onFileSelected}
          accept="application/pdf"
          id="file"
          ref={inputFile}
          style={{ display: "none" }}
        />
        <Card
          className={
            "" +
            `${theme === "dark"
              ? " bg-zinc-900 text-zinc-200 rounded-lg border-2 border-red"
              : " bg-white text-black border-gray-500 border-2 rounded-lg border-red"
            }`
          }
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
                  className={`${theme === "dark"
                    ? "bg-zinc-900 rounded-lg"
                    : "bg-zinc-200 rounded-lg"
                    }`}
                >
                  {["Name", "ID", "Manage"].map((f: string) => (
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
                    theme: theme,
                    isUploading: collectionsUploading.indexOf(rds.name) !== -1,
                    onUploadClick: (rds) => {
                      setTargetCollection(rds);
                      inputFile?.current?.click();
                    },
                    onDelete: (rds) =>
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
