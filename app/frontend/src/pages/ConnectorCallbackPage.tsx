// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const OAUTH_MESSAGE_TYPE = "tt-connector-oauth";

export default function ConnectorCallbackPage() {
  const [params] = useSearchParams();
  const provider = params.get("provider") || "";
  const status = params.get("status") || "success";
  const error = params.get("error") || "";
  const [orphan, setOrphan] = useState(false);

  useEffect(() => {
    const message = {
      type: OAUTH_MESSAGE_TYPE,
      provider,
      status,
      error,
    };
    const opener = window.opener;
    if (opener && opener !== window) {
      try {
        opener.postMessage(message, window.location.origin);
      } catch {
        // cross-origin opener; ignore — the parent will time out
      }
      // Give the postMessage a microtask to flush before closing.
      window.setTimeout(() => window.close(), 50);
    } else {
      setOrphan(true);
    }
  }, [provider, status, error]);

  if (!orphan) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Finishing connection…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <h1 className="text-xl font-semibold">
        {status === "success"
          ? `${provider || "Connector"} connected`
          : `${provider || "Connector"} connection failed`}
      </h1>
      {error ? (
        <p className="max-w-md text-sm text-red-500">{error}</p>
      ) : (
        <p className="max-w-md text-sm text-muted-foreground">
          You can close this tab and return to your chat.
        </p>
      )}
      <Link
        to="/chat"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Return to chat
      </Link>
    </div>
  );
}
