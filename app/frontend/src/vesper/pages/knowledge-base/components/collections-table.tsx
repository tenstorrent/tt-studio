// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Fragment, useRef, useState } from "react";
import { Badge } from "@tenstorrent/vesper/badge";
import { Button } from "@tenstorrent/vesper/button";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import {
  CaretDown,
  CaretUp,
  Document,
  Grid,
  Spinner,
  Trash,
  Upload,
} from "@tenstorrent/vesper/icons";
import { Skeleton } from "@tenstorrent/vesper/skeleton";
import { addToast } from "@tenstorrent/vesper/toast";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { Typography } from "@tenstorrent/vesper/typography";
import { getErrorMessage } from "@/src/utils/errors";
import { ControlledModal } from "@/src/vesper/components/controlled-modal";
import { EmptyPill } from "@/src/vesper/components/empty-pill";
import {
  ACCEPTED_FILES,
  useCollectionDocuments,
  useKnowledgeBaseActions,
  type Collection,
} from "../hooks";

const ACCEPT = Object.values(ACCEPTED_FILES).flat().join(",");

function CollectionRow({
  collection,
  documents,
  documentsLoading,
  odd,
  onDelete,
}: {
  collection: Collection;
  documents: ReturnType<typeof useCollectionDocuments>[number]["data"];
  documentsLoading: boolean;
  odd: boolean;
  onDelete(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadToCollection } = useKnowledgeBaseActions();

  const upload = async (file: File) => {
    setUploading(true);
    try {
      await uploadToCollection(file, collection.name);
      addToast({
        variant: "success",
        content: `Added ${file.name} to ${collection.name}`,
        timeout: 4000,
      });
    } catch (err) {
      addToast({ variant: "danger", content: getErrorMessage(err) });
    } finally {
      setUploading(false);
    }
  };

  const embedding = collection.metadata?.embedding_func_name;

  return (
    <li
      className={
        odd ? "rounded-vesper-2 bg-vesper-tint-neutral-200" : "rounded-vesper-2"
      }
    >
      <div className="grid grid-cols-[minmax(0,2fr)_6rem_minmax(0,1fr)_9rem] items-center gap-vesper-4 px-vesper-4 h-14">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-vesper-3 min-w-0 text-left text-vesper-text-primary"
        >
          {expanded ? (
            <CaretUp className="w-4 h-4 shrink-0 text-vesper-icon-secondary" />
          ) : (
            <CaretDown className="w-4 h-4 shrink-0 text-vesper-icon-secondary" />
          )}
          <Grid
            className="w-4 h-4 shrink-0 text-vesper-icon-accent"
            aria-hidden
          />
          <Typography as="span" variant="copy-sm" className="truncate">
            {collection.name}
          </Typography>
        </button>
        <Typography
          as="span"
          variant="copy-sm"
          className="text-vesper-text-primary"
        >
          {documentsLoading ? "…" : (documents?.totalFiles ?? "---")}
        </Typography>
        <span>
          {embedding ? (
            <Tooltip content={`Embeddings: ${embedding}`}>
              <Badge
                size="sm"
                variant="purple"
                subtle
                as="button"
                type="button"
              >
                Collection
              </Badge>
            </Tooltip>
          ) : (
            <Badge size="sm" variant="purple" subtle>
              Collection
            </Badge>
          )}
        </span>
        <div className="flex items-center justify-end gap-vesper-4">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="xs"
            variant="subtle"
            iconLeft={
              uploading ? <Spinner className="animate-spin" /> : <Upload />
            }
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            Upload
          </Button>
          <IconButton
            type="button"
            size="xs"
            variant="danger"
            icon={<Trash />}
            aria-label={`Delete ${collection.name}`}
            onClick={onDelete}
          />
        </div>
      </div>
      {expanded && (
        <div className="px-vesper-10 pb-vesper-4">
          {documentsLoading ? (
            <Skeleton height={56} />
          ) : !documents || documents.documents.length === 0 ? (
            <Typography
              variant="copy-sm"
              className="px-vesper-4 py-vesper-3 text-vesper-text-tertiary"
            >
              No documents in this collection.
            </Typography>
          ) : (
            <ul className="rounded-vesper-2 border border-vesper-border-secondary bg-vesper-background-primary">
              {documents.documents.map((doc, i) => (
                <Fragment key={`${doc.filename}-${i}`}>
                  {i > 0 && (
                    <li
                      aria-hidden
                      className="border-t border-vesper-border-secondary"
                    />
                  )}
                  <li className="grid grid-cols-[minmax(0,2fr)_6rem_minmax(0,1fr)] items-center gap-vesper-4 px-vesper-4 h-14">
                    <span className="flex items-center gap-vesper-3 min-w-0">
                      <Document
                        className="w-4 h-4 shrink-0 text-vesper-icon-tertiary"
                        aria-hidden
                      />
                      <Typography
                        as="span"
                        variant="copy-sm"
                        className="truncate text-vesper-text-primary"
                      >
                        {doc.filename}
                      </Typography>
                    </span>
                    <Typography
                      as="span"
                      variant="copy-sm"
                      className="uppercase text-vesper-text-primary"
                    >
                      {doc.file_extension?.replace(".", "") || "---"}
                    </Typography>
                    <Typography
                      as="span"
                      variant="copy-xs"
                      className="text-vesper-text-tertiary"
                    >
                      {doc.chunks_count}{" "}
                      {doc.chunks_count === 1 ? "chunk" : "chunks"}
                    </Typography>
                  </li>
                </Fragment>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function CollectionsTable({
  collections,
  loading,
}: {
  collections: Collection[];
  loading: boolean;
}) {
  const documents = useCollectionDocuments(collections.map((c) => c.name));
  const { removeCollection } = useKnowledgeBaseActions();
  const [deleting, setDeleting] = useState<Collection | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="rounded-vesper-4 bg-vesper-background-secondary p-vesper-6">
      <div className="grid grid-cols-[minmax(0,2fr)_6rem_minmax(0,1fr)_9rem] gap-vesper-4 px-vesper-4 pb-vesper-4 border-b border-vesper-border-secondary">
        {["Collection Name", "Files", "Status"].map((column) => (
          <Typography
            key={column}
            variant="label-md"
            className="text-vesper-text-secondary"
          >
            {column}
          </Typography>
        ))}
        <span aria-hidden />
      </div>
      {loading ? (
        <div className="flex flex-col gap-vesper-2 pt-vesper-4">
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : collections.length === 0 ? (
        <div className="h-80 flex items-center justify-center">
          <EmptyPill>No Documents</EmptyPill>
        </div>
      ) : (
        <ul className="flex flex-col pt-vesper-4">
          {collections.map((collection, i) => (
            <CollectionRow
              key={collection.id ?? collection.name}
              collection={collection}
              documents={documents[i]?.data}
              documentsLoading={documents[i]?.isPending ?? true}
              odd={i % 2 === 1}
              onDelete={() => setDeleting(collection)}
            />
          ))}
        </ul>
      )}
      <ControlledModal
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDeleting(null);
        }}
        title="Delete collection?"
        description={`"${deleting?.name ?? ""}" and every document in it will be removed from the knowledge base. Chats using it won't be able to retrieve from it anymore.`}
        width={480}
        buttons={[
          {
            children: "Cancel",
            disabled: pending,
            onClick: () => setDeleting(null),
          },
          {
            children: pending ? "Deleting" : "Delete",
            variant: "danger",
            disabled: pending,
            onClick: async () => {
              if (!deleting) return;
              setPending(true);
              try {
                await removeCollection(deleting.name);
                addToast({
                  variant: "success",
                  content: `Deleted ${deleting.name}`,
                  timeout: 4000,
                });
                setDeleting(null);
              } catch (err) {
                addToast({ variant: "danger", content: getErrorMessage(err) });
              } finally {
                setPending(false);
              }
            },
          },
        ]}
      />
    </div>
  );
}
