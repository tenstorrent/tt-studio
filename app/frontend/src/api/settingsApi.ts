// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";

const SETTINGS_URL = "/settings-api/";
const HF_CHECK_URL = "/settings-api/hf-check/";

export interface SettingField {
  set: boolean;
  masked: string | null;
  source: "env" | null;
  editable: boolean;
}

export interface ArtifactInfo {
  branch: string | null;
  version: string | null;
  editable: false;
  description: string;
}

export interface SettingsResponse {
  setup_complete: boolean;
  jwt_secret: SettingField;
  tavily_api_key: SettingField;
  hf_token: SettingField;
  tts_api_key: SettingField;
  artifact: ArtifactInfo;
}

export interface UpdateSettingsPayload {
  hf_token?: string;
  tts_api_key?: string;
  tavily_api_key?: string;
  setup_complete?: true;
}

export interface UpdateSettingsResponse {
  ok: boolean;
  requires_redeploy: boolean;
  updated: string[];
}

export type HfCheckStatus =
  | "granted"
  | "denied"
  | "auth_failed"
  | "error"
  | "no_token";

export interface HfCheckResult {
  label: string;
  repo: string;
  status: HfCheckStatus;
  http_status?: number | null;
  url: string;
}

export interface HfCheckResponse {
  ok: boolean;
  error?: string;
  results: HfCheckResult[];
}

export async function getSettings(): Promise<SettingsResponse> {
  const { data } = await axios.get<SettingsResponse>(SETTINGS_URL);
  return data;
}

export async function updateSettings(
  payload: UpdateSettingsPayload
): Promise<UpdateSettingsResponse> {
  const { data } = await axios.post<UpdateSettingsResponse>(
    SETTINGS_URL,
    payload
  );
  return data;
}

export async function runHfCheck(token?: string): Promise<HfCheckResponse> {
  const { data } = await axios.post<HfCheckResponse>(HF_CHECK_URL, {
    ...(token ? { hf_token: token } : {}),
  });
  return data;
}
