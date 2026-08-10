// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import axios from "axios";
import { customToast } from "../CustomToaster";

const collectionsAPIURL = "/collections-api";

// Add browser ID to headers for all axios requests
axios.interceptors.request.use((config) => {
  const browserId = localStorage.getItem("tt_studio_browser_id");
  if (browserId) {
    config.headers["X-Browser-ID"] = browserId;
  }
  return config;
});

/**
 * True for the documentation collection the backend seeds at startup, as
 * opposed to a collection the user created.
 *
 * It doesn't belong in a "Your Collections" picker: the user didn't make it, and
 * the backend already merges it into every collection query
 * (`vector_db_control/views.py`), so "All Collections" reaches it either way.
 * Mirrors the signals RagManagement already keys off.
 */
export const isSystemKnowledgeCollection = (collection: {
  name?: string;
  metadata?: { type?: string; created_by?: string } | null;
}): boolean =>
  collection?.metadata?.type === "internal_knowledge" ||
  collection?.metadata?.created_by === "system" ||
  collection?.name === "tenstorrent_internal_knowledge";

export const fetchCollections = async () => {
  try {
    const response = await axios.get(`${collectionsAPIURL}/`);
    if (Array.isArray(response?.data)) {
      return response.data;
    }

    console.error(
      "Unexpected collections payload shape. Expected array, received:",
      response?.data
    );
    return [];
  } catch (error) {
    console.error("Error fetching collections:", error);
    throw error;
  }
};

export const createCollection = async ({
  collectionName,
}: {
  collectionName: string;
}) => {
  try {
    const response = await axios.post(`${collectionsAPIURL}/`, {
      name: collectionName,
    });
    return response.data;
  } catch (error) {
    console.error("Error creating collection:", error);
    // Extract error message from the response if available
    if (axios.isAxiosError(error) && error.response?.data?.error) {
      customToast.error("Collection name already exists");
      throw new Error(error.response.data.error);
    }
    throw error;
  }
};

export const deleteCollection = async ({
  collectionName,
}: {
  collectionName: string;
}) => {
  try {
    return await axios.delete(`${collectionsAPIURL}/${collectionName}`);
  } catch (error) {
    console.error("Error deleting collection:", error);
    throw error;
  }
};

export const uploadDocument = async ({
  file,
  collectionName,
}: {
  file: File;
  collectionName: string;
}) => {
  try {
    // Fix the URL to match the Django @action URL pattern
    const formData = new FormData();
    formData.append("document", file);

    return await axios.post(
      `${collectionsAPIURL}/${collectionName}/insert_document`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );
  } catch (error) {
    console.error("Error uploading document:", error);
    // Surface the backend's reason (e.g. "Unsupported file type") to callers
    if (axios.isAxiosError(error) && error.response?.data?.error) {
      throw new Error(error.response.data.error);
    }
    throw error;
  }
};

export const fetchDocuments = async (collectionName: string) => {
  try {
    const response = await axios.get(
      `${collectionsAPIURL}/${collectionName}/documents`
    );
    if (response?.data) {
      return response.data;
    }
    return { documents: [], total_files: 0 };
  } catch (error) {
    console.error("Error fetching documents:", error);
    throw error;
  }
};
