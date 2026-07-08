// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";
import type { VideoGenPhase } from "../types/chat";

const BASE_URL = "/models-api/video-generation/";

export type SubmitVideoResult =
  | { kind: "job"; jobId: string }
  | { kind: "video"; videoUrl: string };

// Submit a generation request. In async mode the server returns a job id to poll;
// in sync mode (USE_ASYNC_VIDEO=False) it returns the MP4 bytes directly.
export const submitVideoGeneration = async (
  prompt: string,
  modelID: string
): Promise<SubmitVideoResult> => {
  const formData = new FormData();
  formData.append("deploy_id", modelID);
  formData.append("prompt", prompt);

  const response = await axios.post(BASE_URL, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    responseType: "blob",
    timeout: 60000,
    validateStatus: (s) => s >= 200 && s < 300,
  });

  const contentType = response.headers["content-type"] || "";

  // Async mode: JSON body with a job id (delivered as a blob, so parse the text).
  if (contentType.includes("application/json")) {
    const text = await (response.data as Blob).text();
    const job = JSON.parse(text);
    const jobId = job.job_id || job.id;
    if (!jobId) {
      throw new Error("No job_id in video generation response");
    }
    return { kind: "job", jobId };
  }

  // Sync mode: the response is the finished video.
  return { kind: "video", videoUrl: URL.createObjectURL(response.data) };
};

// Poll the phase of an async video generation job.
export const getVideoStatus = async (
  jobId: string,
  modelID: string
): Promise<VideoGenPhase> => {
  const response = await axios.get(
    `${BASE_URL}status/${encodeURIComponent(jobId)}/`,
    {
      params: { deploy_id: modelID },
      timeout: 30000,
    }
  );
  return response.data.phase as VideoGenPhase;
};

// Download the finished video and return an object URL for playback.
export const downloadVideo = async (
  jobId: string,
  modelID: string
): Promise<string> => {
  const response = await axios.get(
    `${BASE_URL}download/${encodeURIComponent(jobId)}/`,
    {
      params: { deploy_id: modelID },
      responseType: "blob",
      timeout: 60000,
    }
  );
  return URL.createObjectURL(response.data);
};
