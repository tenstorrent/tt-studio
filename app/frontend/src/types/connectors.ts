// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface AvailableConnector {
  slug: string;
  name: string;
  description: string;
  icon_url: string;
  composio_toolkit: string;
  configured: boolean;
}

// Composio connection status values surfaced verbatim from the SDK.
export type ConnectionStatus =
  | "INITIALIZING"
  | "INITIATED"
  | "ACTIVE"
  | "FAILED"
  | "EXPIRED"
  | "INACTIVE"
  | "REVOKED";

export interface Connection {
  id: string | null;
  provider: string;
  status: ConnectionStatus | string | null;
}

export interface InitiateOAuthResponse {
  connection_id: string;
  auth_url: string;
  status: string;
}

export type ToolCallEvent =
  | {
      event: "tool_call_started";
      id: string;
      tool: string;
      input?: string;
    }
  | {
      event: "tool_call_completed";
      id: string;
      tool: string;
      output_summary?: string;
    };
