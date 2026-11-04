// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import type { CatalogModel } from "@/src/vesper/types";

export const MODEL_CATALOG_QUERY_KEY = ["model-catalog"];

async function fetchModelCatalog() {
  const { data } = await axios.get<CatalogModel[]>(
    "/docker-api/get_containers/"
  );
  return Array.isArray(data) ? data : [];
}

/** Every model TT-Studio knows how to deploy, with per-board compatibility. */
export function useModelCatalog() {
  return useQuery({
    queryKey: MODEL_CATALOG_QUERY_KEY,
    queryFn: fetchModelCatalog,
    staleTime: 5 * 60_000,
  });
}
