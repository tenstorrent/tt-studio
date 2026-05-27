// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Plug } from "lucide-react";

interface Props {
  count: number;
  onClick: () => void;
}

export function ConnectorBadge({ count, onClick }: Props) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs font-medium hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
      aria-label="Manage connectors"
    >
      <Plug className="h-3 w-3" />
      <span>{count} connector{count === 1 ? "" : "s"}</span>
    </button>
  );
}
