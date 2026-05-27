// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import axios, { AxiosError } from "axios";

import { getSessionIdSync, initSessionId } from "../lib/sessionId";
import type {
  AvailableConnector,
  Connection,
  InitiateOAuthResponse,
} from "../types/connectors";

const client = axios.create({ baseURL: "/connectors-api" });

client.interceptors.request.use(async (config) => {
  let sessionId = getSessionIdSync();
  if (!sessionId) {
    sessionId = await initSessionId();
  }
  config.headers = config.headers ?? {};
  (config.headers as Record<string, string>)["X-Session-Id"] = sessionId;
  return config;
});

export class ConnectorsApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function toApiError(e: unknown, fallback: string): ConnectorsApiError {
  if (axios.isAxiosError(e)) {
    const ax = e as AxiosError<{ error?: string }>;
    const message = ax.response?.data?.error || ax.message || fallback;
    return new ConnectorsApiError(message, ax.response?.status ?? 0);
  }
  return new ConnectorsApiError(fallback, 0);
}

export async function listAvailable(): Promise<AvailableConnector[]> {
  try {
    const res = await client.get<{ connectors: AvailableConnector[] }>(
      "/available/"
    );
    return res.data.connectors;
  } catch (e) {
    throw toApiError(e, "Failed to load connector catalog");
  }
}

export async function listConnections(): Promise<Connection[]> {
  try {
    const res = await client.get<{ connections: Connection[] }>("/connections/");
    return res.data.connections;
  } catch (e) {
    throw toApiError(e, "Failed to load your connections");
  }
}

export async function initiateConnection(
  provider: string
): Promise<InitiateOAuthResponse> {
  try {
    const res = await client.post<InitiateOAuthResponse>(
      `/connect/${provider}/`
    );
    return res.data;
  } catch (e) {
    throw toApiError(e, `Failed to start ${provider} connection`);
  }
}

export async function disconnectConnector(provider: string): Promise<number> {
  try {
    const res = await client.delete<{ deleted: number }>(
      `/connections/${provider}/`
    );
    return res.data.deleted;
  } catch (e) {
    throw toApiError(e, `Failed to disconnect ${provider}`);
  }
}
