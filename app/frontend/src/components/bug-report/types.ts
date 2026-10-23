// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/** "drafted": mail app opened + logs ZIP downloaded to drag in.
 *  "downloaded": .eml with the logs ZIP already attached downloaded. */
export type BugReportStep = "form" | "drafted" | "downloaded";

export interface BugReportForm {
  title: string;
  description: string;
  steps: string;
}
