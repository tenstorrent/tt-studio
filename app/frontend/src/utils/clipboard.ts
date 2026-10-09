// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { getErrorMessage } from "./errors";

/**
 * Attempts to copy a string to the user's clipboard. If it fails, returns `null`,
 * otherwise returns an error message.
 */
export const copyToClipboard = async (text: string): Promise<null | string> => {
  try {
    await navigator.clipboard.writeText(text);
    return null;
  } catch (err) {
    return getErrorMessage(err);
  }
};
