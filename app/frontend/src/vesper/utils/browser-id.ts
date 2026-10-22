// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { v4 as uuidv4 } from "uuid";

const BROWSER_ID_KEY = "tt_studio_browser_id";

/**
 * Knowledge base collections are scoped to a browser via the `X-Browser-ID`
 * header (see `components/rag/index.ts`), which only attaches it when an id is
 * already stored. Make sure one exists before any collections request is sent.
 */
export function getBrowserId(): string {
  try {
    let id = localStorage.getItem(BROWSER_ID_KEY);
    if (!id) {
      id = uuidv4();
      localStorage.setItem(BROWSER_ID_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}
