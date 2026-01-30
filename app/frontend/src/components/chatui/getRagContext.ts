// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
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

    // If special-all is specified, query across all collections
    if (ragDatasource.id === "special-all") {
      console.log("Querying across all collections");
      try {
        const response = await axios.get(`/collections-api/query-all`, {
          params: { query_text: request.text, limit: 5 },
          headers: {
            "X-Browser-ID": browserId,
          },
        });

        console.log("Query-all response:", response);

        if (response?.data?.results) {
          // Format results to include collection name
          ragContext.documents = response.data.results.map(
            (result: any) =>
              `[From ${result.collection.name}]\n${result.document}`
          );
          console.log("Processed documents:", ragContext.documents.length);
        } else {
          console.warn(
            "No results found in query-all response:",
            response.data
          );
        }
      } catch (error: any) {
        console.error(`Error querying all collections: ${error.message}`);
        console.error(
          "Error details:",
          error.response?.data || "No response data"
        );
      }
    } else {
      // Standard single collection query
      console.log(`Querying single collection: ${ragDatasource.name}`);
      try {
        const response = await axios.get(
          `/collections-api/${ragDatasource.name}/query`,
          {
            params: { query_text: request.text },
            headers: {
              "X-Browser-ID": browserId,
            },
          }
        );

        console.log("Single collection response:", response);

        if (response?.data) {
           const docs = response.data.documents;
          if (Array.isArray(docs)) {
            const items = docs.flat(Infinity);
            ragContext.documents = items.map((d: any) => {
	              if (typeof d === "string") {
	                return d;
	              } else if (d?.document) {
	                return d.document;
	              } else if (d?.text) {
	                return d.text;
	              } else {
	                console.warn("Unrecognized document format in RAG response:", d);
	                return "[Unrecognized document format]";
	              }
	            });
          } else {
            // If it's not an array, fall back to empty array for safety.
            ragContext.documents = [];
          }
          console.log("Processed documents:", ragContext.documents.length);
        } else {
          console.warn(
            "No results found in single collection response:",
            response.data
          );
        }
      } catch (error: any) {
        console.error(
          `Error querying collection ${ragDatasource.name}: ${error.message}`
        );
        console.error(
          "Error details:",
          error.response?.data || "No response data"
        );
      }
    }
  } catch (e) {
    console.error(`Error fetching RAG context: ${e}`);
  }

  return ragContext;
};
