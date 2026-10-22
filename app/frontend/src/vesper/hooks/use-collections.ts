// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useQuery } from "@tanstack/react-query";
import { fetchCollections } from "@/src/components/rag";
import { getBrowserId } from "@/src/vesper/utils/browser-id";

// collections are scoped to this browser by id; make sure it has one before
// anything asks for them
getBrowserId();

/** Shared with every knowledge base picker, so they refresh together. */
export const COLLECTIONS_QUERY_KEY = ["collectionsList"];

/** Selecting this id retrieves from every collection at once. */
export const ALL_COLLECTIONS_ID = "special-all";

export interface Collection {
  id: string;
  name: string;
  metadata?: Record<string, string | undefined>;
}

export function useCollections() {
  return useQuery<Collection[]>({
    queryKey: COLLECTIONS_QUERY_KEY,
    queryFn: fetchCollections,
  });
}
