// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { extractShortModelName } from "../../../api/modelsDeployedApis";

interface Props {
  name?: string;
}

export default React.memo(function ModelNameCell({ name }: Props) {
  if (!name) return <>N/A</>;
  return <span className="text-gray-200">{extractShortModelName(name)}</span>;
});
