// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { createContext } from "react";

export type BackendStatus = "connected" | "disconnected" | "checking";

export interface BackendHealthContextType {
  /**
   * "connected"    — the backend responded to the most recent liveness poll.
   * "disconnected" — the backend has failed enough consecutive polls to be
   *                  considered unreachable (the blocking overlay is shown).
   * "checking"     — a poll is in flight (used to show a spinner on the
   *                  overlay's retry button).
   */
  status: BackendStatus;
  /** Cancel the scheduled poll and probe the backend immediately. */
  retry: () => void;
}

export const BackendHealthContext = createContext<
  BackendHealthContextType | undefined
>(undefined);
