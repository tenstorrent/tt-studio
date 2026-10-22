// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Document } from "@tenstorrent/vesper/icons";
import { Select } from "@tenstorrent/vesper/select";
import type { RagDataSource } from "@/src/components/chatui/types";
import {
  ALL_COLLECTIONS_ID,
  useCollections,
} from "@/src/vesper/hooks/use-collections";

const NONE = "__none__";

/** Picks the knowledge base (if any) a chat retrieves context from. */
export function KnowledgeBasePicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: RagDataSource | undefined;
  onChange(value: RagDataSource | undefined): void;
  disabled?: boolean;
  className?: string;
}) {
  const collections = useCollections();
  const list = collections.data ?? [];
  const options = [
    { value: NONE, label: "No knowledge base" },
    ...(list.length > 1
      ? [{ value: ALL_COLLECTIONS_ID, label: "All collections" }]
      : []),
    ...list.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <Select
      size="sm"
      className={className}
      aria-label="Knowledge base"
      icon={<Document />}
      placeholder="Select knowledge base"
      disabled={disabled || list.length === 0}
      options={options}
      value={value?.id ?? null}
      onValueChange={(id) => {
        if (!id || id === NONE) return onChange(undefined);
        if (id === ALL_COLLECTIONS_ID)
          return onChange({ id: ALL_COLLECTIONS_ID, name: "All collections" });
        const collection = list.find((c) => c.id === id);
        onChange(
          collection ? { id: collection.id, name: collection.name } : undefined
        );
      }}
    />
  );
}
