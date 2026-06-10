// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from "react";
import StatusBadge from "../../StatusBadge";

interface Props {
  status?: string;
}

export default React.memo(function StatusCell({ status }: Props) {
  if (!status) return <>N/A</>;
  return <StatusBadge status={status} />;
});
