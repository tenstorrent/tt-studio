// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { Button } from "../../ui/button";
import type { HealthStatus } from "../../../types/models";

interface Props {
  id: string;
  name?: string;
  image?: string;
  health?: HealthStatus;
  onDelete: (id: string) => void;
  onRedeploy: (image?: string) => void;
  onNavigateToModel: (id: string, name: string, navigate?: any) => void;
  onOpenApi: (id: string) => void;
}

export default React.memo(function ManageCell({
  id,
  name,
  image,
  health: _health,
  onDelete,
  onRedeploy,
  onNavigateToModel,
  onOpenApi,
}: Props) {
  return (
    <div className="flex items-center justify-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpenApi(id)}
        className="px-3 py-2"
      >
        API
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onNavigateToModel(id, name ?? id)}
        className="px-3 py-2"
      >
        Open
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onRedeploy(image)}
        className="px-3 py-2"
      >
        Redeploy
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onDelete(id)}
        className="px-3 py-2 text-red-600 border-red-400 hover:bg-red-50 dark:hover:bg-red-950"
      >
        Delete
      </Button>
    </div>
  );
});
