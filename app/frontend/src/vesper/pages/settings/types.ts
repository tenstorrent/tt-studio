// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { SettingsResponse } from "@/src/api/settingsApi";
import type { UseQueryResult } from "@tanstack/react-query";

export type APIKeyName = "tavily_api_key" | "hf_token" | "tts_api_key";

export type SettingsContextData = {
  hfToken: string;
  setHfToken(value: string): void;
  tavilyApiKey: string;
  setTavilyApiKey(value: string): void;
  settings: UseQueryResult<SettingsResponse, Error>;
};
