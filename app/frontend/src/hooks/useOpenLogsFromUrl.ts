// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function useOpenLogsFromUrl(
  open: boolean,
  setOpenId: (id: string | null) => void
) {
  const location = useLocation();

  // Read and apply openLogs param
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const openLogsId = urlParams.get("openLogs");
    if (openLogsId) {
      setOpenId(openLogsId);
    }
  }, [location.search, setOpenId]);

  // Clean up URL parameter once dialog is open
  useEffect(() => {
    if (open && location.search.includes("openLogs=")) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [open, location.search]);
}
