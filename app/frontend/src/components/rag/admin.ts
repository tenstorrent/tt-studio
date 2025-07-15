// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import axios from "axios";
import { customToast } from "../CustomToaster";

const collectionsAPIURL = "/collections-api";

// Authenticate admin
export const authenticateAdmin = async (password: string) => {
  try {
    const response = await axios.post(
      `${collectionsAPIURL}/admin/authenticate`,
      {
        password,
      },
    );
    return response.data;
  } catch (error) {
    console.error("Admin authentication error:", error);
    if (axios.isAxiosError(error) && error.response?.data?.error) {
      customToast.error(error.response.data.error);
      throw new Error(error.response.data.error);
    }
    throw error;
  }
};

// Get all collections (admin view)
export const fetchAllCollections = async (password: string) => {
  try {
    const response = await axios.post(
      `${collectionsAPIURL}/admin/collections`,
      {
        password,
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching admin collections:", error);
    if (axios.isAxiosError(error) && error.response?.data?.error) {
      customToast.error(error.response.data.error);
      throw new Error(error.response.data.error);
    }
    throw error;
  }
};

// Delete a collection (admin function)
export const deleteCollectionAdmin = async (
  collectionId: string,
  password: string,
) => {
  try {
    const response = await axios.post(
      `${collectionsAPIURL}/admin/delete-collection`,
      {
        collection_name: collectionId,
        password,
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error deleting collection:", error);
    if (axios.isAxiosError(error) && error.response?.data?.error) {
      customToast.error(error.response.data.error);
      throw new Error(error.response.data.error);
    }
    throw error;
  }
};
