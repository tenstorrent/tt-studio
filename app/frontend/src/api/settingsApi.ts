// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios from "axios";

const SETTINGS_URL = "/settings-api/";

export interface SettingField {
  set: boolean;
  masked: string | null;
  source: "user_config" | "env" | null;
}

export interface SettingsResponse {
  jwt_secret: SettingField;
  tavily_api_key: SettingField;
}

export interface UpdateSettingsPayload {
  jwt_secret?: string;
  tavily_api_key?: string;
}

export interface UpdateSettingsResponse {
  ok: boolean;
  requires_redeploy: boolean;
  updated: string[];
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
