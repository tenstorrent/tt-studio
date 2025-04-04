// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import axios from "axios";
import { InferenceRequest, RagDataSource } from "./types.ts";

export const getRagContext = async (
  request: InferenceRequest,
  ragDatasource: RagDataSource | undefined
) => {
  const ragContext: { documents: string[] } = { documents: [] };
  console.log(
    "2^^^Fetching RAG context for the given request...",
    request,
    ragDatasource
  );

  if (!ragDatasource) return ragContext;

  try {
    // Get browser ID from localStorage
    const browserId = localStorage.getItem("tt_studio_browser_id");
    console.log(`Browser ID: ${browserId}`);

    const response = await axios.get(
      `/collections-api/${ragDatasource.name}/query`,
      {
        params: { query: request.text },
        headers: {
          "X-Browser-ID": browserId,
        },
      }
    );
    if (response?.data) {
      ragContext.documents = response.data.documents;
    }
  } catch (e) {
    console.error(`Error fetching RAG context: ${e}`);
  }

  return ragContext;
};
