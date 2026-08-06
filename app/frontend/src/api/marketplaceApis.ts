// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios from "axios";

const marketplaceURL = "/models-api/marketplace/apps/";

export type MarketplaceAppStatus =
  | "guide"
  | "not_installed"
  | "pulling"
  | "starting"
  | "running"
  | "stopped"
  | "error";

export interface MarketplaceApp {
  id: string;
  name: string;
  tagline: string;
  category: string;
  kind: "container" | "guide";
  docs_url: string;
  first_run_note: string | null;
  status: MarketplaceAppStatus;
  message?: string;
  progress?: { downloaded_bytes: number; total_bytes: number };
  container_id?: string;
  host_port?: number | null;
  open_path?: string;
  // Present for apps configured through their own UI: the endpoint to paste in,
  // as reachable from inside the app's container.
  connection?: { base_url: string; api_key: string; model: string };
}

export interface MarketplaceInfo {
  gateway_configured: boolean;
  apps: MarketplaceApp[];
}

export const fetchMarketplaceApps = async (): Promise<MarketplaceInfo> => {
  const response = await axios.get<MarketplaceInfo>(marketplaceURL, {
    timeout: 10000,
    headers: { "Cache-Control": "no-cache" },
  });
  return response.data;
};

export const launchMarketplaceApp = async (appId: string): Promise<void> => {
  await axios.post(`${marketplaceURL}${appId}/launch/`);
};

export const stopMarketplaceApp = async (appId: string): Promise<void> => {
  await axios.post(`${marketplaceURL}${appId}/stop/`);
};
