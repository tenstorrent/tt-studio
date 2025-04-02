// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
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

export const fetchCollections = async () => {
  try {
    const response = await axios.get(`${collectionsAPIURL}/`);
    if (response?.data) {
      return response.data;
    }
    return [];
  } catch (error) {
    customToast.error("Error fetching collections");
    // console.error("Error fetching collections:", error);
    throw error;
  }
};

export const createCollection = async ({ collectionName }: { collectionName: string }) => {
  try {
    const response = await axios.post(`${collectionsAPIURL}/`, {
      name: collectionName,
    });
    return response.data;
  } catch (error) {
    customToast.error("Error creating collection");
    // Extract error message from the response if available
    if (axios.isAxiosError(error) && error.response?.data?.error) {
      customToast.error("Collection name already exists");
      throw new Error(error.response.data.error);
    }
    throw error;
  }
};

export const deleteCollection = async ({ collectionName }: { collectionName: string }) => {
  try {
    return await axios.delete(`${collectionsAPIURL}/${collectionName}`);
  } catch (error) {
    customToast.error("Error deleting collection");
    // console.error("Error deleting collection:", error);
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
    formData.append("file", file);

    return await axios.post(`${collectionsAPIURL}/${collectionName}/insert_document`, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  } catch (error) {
    customToast.error("Error uploading document");
    throw error;
  }
};
