// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import axios from "axios";

const collectionsAPIURL = "/collections-api";

export const fetchCollections = async () => {
  const response = await axios.get(`${collectionsAPIURL}/`);
  console.log(response);
  if (response?.data) {
    return response.data;
  }
  return [];
};

export const createCollection = ({
  collectionName,
}: {
  collectionName: string;
}) => axios.post(`${collectionsAPIURL}/`, { name: collectionName });

export const deleteCollection = async ({
  collectionName,
}: {
  collectionName: string;
}) => {
  return axios.delete(`${collectionsAPIURL}/${collectionName}`);
};

export const uploadDocument = async ({
  file,
  collectionName,
}: {
  file: File;
  collectionName: string;
}) => {
  return axios.postForm(
    `${collectionsAPIURL}/${collectionName}/insert_document`,
    { file },
  );
};
