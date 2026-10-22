// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Admonition } from "@tenstorrent/vesper/admonition";
import { CollectionsTable } from "./components/collections-table";
import { UploadDropzone } from "./components/upload-dropzone";
import { useCollections } from "./hooks";

export default function KnowledgeBasePage() {
  const collections = useCollections();
  const list = collections.data ?? [];

  return (
    <div className="min-h-full flex flex-col gap-vesper-16 px-vesper-16 py-vesper-16 text-left">
      <UploadDropzone existingCollections={list.map((c) => c.name)} />
      {collections.isError && (
        <Admonition variant="danger" subtle>
          Couldn't load the knowledge base. Check that the backend and vector
          database are running.
        </Admonition>
      )}
      <CollectionsTable collections={list} loading={collections.isPending} />
    </div>
  );
}
