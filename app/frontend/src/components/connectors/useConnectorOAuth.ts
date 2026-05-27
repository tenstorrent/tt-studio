// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef } from "react";

import { initiateConnection } from "../../api/connectorsApi";

const OAUTH_MESSAGE_TYPE = "tt-connector-oauth";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

export interface OAuthResult {
  provider: string;
  status: "success" | "failed";
  error?: string;
}

interface PendingFlow {
  provider: string;
  resolve: (r: OAuthResult) => void;
  reject: (e: Error) => void;
  timer: number;
  popup: Window | null;
}

export function useConnectorOAuth() {
  const pendingRef = useRef<PendingFlow | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; provider?: string; status?: string; error?: string };
      if (!data || data.type !== OAUTH_MESSAGE_TYPE) return;
      const pending = pendingRef.current;
      if (!pending) return;
      if (data.provider && data.provider !== pending.provider) return;
      window.clearTimeout(pending.timer);
      pendingRef.current = null;
      pending.resolve({
        provider: pending.provider,
        status: (data.status as "success" | "failed") || "success",
        error: data.error,
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const connect = useCallback(async (provider: string): Promise<OAuthResult> => {
    const { auth_url } = await initiateConnection(provider);

    if (pendingRef.current) {
      pendingRef.current.reject(new Error("Replaced by a new OAuth flow"));
      window.clearTimeout(pendingRef.current.timer);
      pendingRef.current.popup?.close();
    }

    const popup = window.open(
      auth_url,
      "tt-connector-oauth",
      "popup=1,width=600,height=720"
    );

    return new Promise<OAuthResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRef.current = null;
        popup?.close();
        reject(new Error("Timed out waiting for OAuth completion"));
      }, OAUTH_TIMEOUT_MS);

      pendingRef.current = { provider, resolve, reject, timer, popup };

      if (!popup) {
        // Popup blocked — fall back to same-window redirect.
        window.clearTimeout(timer);
        pendingRef.current = null;
        window.location.href = auth_url;
      }
    });
  }, []);

  return { connect };
}
