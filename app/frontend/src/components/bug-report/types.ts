// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export type BugReportStep = "form" | "done";

export interface BugReportForm {
  title: string;
  description: string;
}
