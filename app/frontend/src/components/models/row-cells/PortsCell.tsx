// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import CopyableText from "../../CopyableText";

interface Props {
  ports?: string;
}

export default React.memo(function PortsCell({ ports }: Props) {
  if (!ports) return <>N/A</>;
  return <CopyableText text={ports} />;
});

