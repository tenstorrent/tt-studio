// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import HealthBadge, {
  type HealthBadgeRef,
  type StartupPhase,
} from "../../HealthBadge";
import type { HealthStatus } from "../../../types/models";

interface Props {
  id: string;
  register: (id: string, node: HealthBadgeRef | null) => void;
  onHealthChange?: (
    id: string,
    h: HealthStatus,
    phase?: StartupPhase | null,
  ) => void;
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
        onHealthChange={(h, phase) =>
          onHealthChange?.(id, h as HealthStatus, phase)
        }
      />
    </div>
  );
});
