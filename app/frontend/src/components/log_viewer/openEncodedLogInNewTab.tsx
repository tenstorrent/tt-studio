// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { logsAPIURL } from "./LogViewer";

export function openEncodedLogInNewTab() {
  return (logName: string) => {
    const encodedLogName = encodeURIComponent(logName);
    const logUrl = `${logsAPIURL}${encodedLogName}/`;
    window.open(logUrl, "_blank", "noopener,noreferrer");
  };
}
