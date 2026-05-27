// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";

import { getSessionIdSync, initSessionId } from "../lib/sessionId";

export function useSessionId(): string | null {
  const [id, setId] = useState<string | null>(() => getSessionIdSync());

  useEffect(() => {
    if (id) return;
    let mounted = true;
    initSessionId().then((value) => {
      if (mounted) setId(value);
    });
    return () => {
      mounted = false;
    };
  }, [id]);

  return id;
}
