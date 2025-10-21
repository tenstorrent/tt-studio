// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import CopyableText from "../../CopyableText";

interface Props {
  image?: string;
}

export default React.memo(function ImageCell({ image }: Props) {
  if (!image) return <>N/A</>;
  return <CopyableText text={image} />;
});
