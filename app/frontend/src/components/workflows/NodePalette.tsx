// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type React from "react";
import {
  MessageSquare,
  Database,
  Bot,
  ArrowRightToLine,
  ArrowLeftFromLine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WorkflowNodeType } from "../../types/workflow";

interface PaletteItem {
  type: WorkflowNodeType;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: "input",
    label: "Input",
    description: "User prompt entry point",
    icon: ArrowRightToLine,
    color: "text-emerald-400",
  },
  {
    type: "llm",
    label: "LLM",
    description: "Chat model inference",
    icon: MessageSquare,
    color: "text-violet-400",
  },
  {
    type: "rag_query",
    label: "RAG Query",
    description: "Search document collections",
    icon: Database,
    color: "text-blue-400",
  },
  {
    type: "agent",
    label: "Agent",
    description: "Autonomous reasoning with tools",
    icon: Bot,
    color: "text-amber-400",
  },
  {
    type: "output",
    label: "Output",
    description: "Final result display",
    icon: ArrowLeftFromLine,
    color: "text-rose-400",
  },
];

function PaletteCard({ item }: { item: PaletteItem }) {
  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData("application/workflow-node-type", item.type);
    event.dataTransfer.effectAllowed = "move";
  };

  const Icon = item.icon;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex items-center gap-3 p-3 rounded-lg border border-zinc-700 bg-zinc-800/50 
                 hover:bg-zinc-700/50 hover:border-zinc-600 cursor-grab active:cursor-grabbing 
                 transition-colors select-none"
    >
      <Icon className={`w-5 h-5 ${item.color} shrink-0`} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-200 truncate">
          {item.label}
        </p>
        <p className="text-xs text-zinc-500 truncate">{item.description}</p>
      </div>
    </div>
  );
}

export default function NodePalette() {
  return (
    <div className="h-full bg-zinc-900 border-r border-zinc-800 p-4 flex flex-col gap-1">
      <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
        Node Types
      </h2>
      <p className="text-xs text-zinc-500 mb-4">
        Drag a node onto the canvas to add it to your workflow.
      </p>
      <div className="flex flex-col gap-2">
        {PALETTE_ITEMS.map((item) => (
          <PaletteCard key={item.type} item={item} />
        ))}
      </div>
    </div>
  );
}
