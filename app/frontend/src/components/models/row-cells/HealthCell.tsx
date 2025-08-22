// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import HealthBadge, { type HealthBadgeRef } from "../../HealthBadge";
import type { HealthStatus } from "../../../types/models";

interface Props {
  id: string;
  register: (id: string, node: HealthBadgeRef | null) => void;
  onHealthChange?: (id: string, h: HealthStatus) => void;
}

export default React.memo(function HealthCell({
  id,
  register,
  onHealthChange,
}: Props) {
  return (
    <div className="inline-flex">
      <HealthBadge
        ref={(node) => register(id, node)}
        deployId={id}
        onHealthChange={(h) => onHealthChange?.(id, h as HealthStatus)}
      />
    </div>
  );
});
