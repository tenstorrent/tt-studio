// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { Mic, Volume2, MessageSquare, type LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type {
  PipelineStage,
  DeployedModel,
  DeployedModelState,
  DeployedModelOptions,
  ModelSlot,
} from "./types";

interface StatusPanelProps {
  stage: PipelineStage;
  models: DeployedModelState;
  modelOptions: DeployedModelOptions;
  onSelectModel: (slot: ModelSlot, id: string) => void;
  conversationId: string | null;
  messageCount: number;
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: "Idle",
  recording: "Recording",
  transcribing: "Transcribing",
  retrieving: "Retrieving",
  searching: "Searching",
  thinking: "Thinking",
  speaking: "Speaking",
  done: "Done",
};

const STAGE_COLORS: Record<PipelineStage, string> = {
  idle: "text-TT-purple-accent",
  recording: "text-TT-red-accent",
  transcribing: "text-TT-yellow",
  retrieving: "text-TT-yellow",
  searching: "text-TT-yellow",
  thinking: "text-TT-yellow",
  speaking: "text-TT-green",
  done: "text-TT-purple-accent",
};

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 shrink-0 rounded-full",
        connected ? "bg-green-500" : "bg-gray-400"
      )}
    />
  );
}

const MODEL_ROWS: { slot: ModelSlot; label: string; icon: LucideIcon }[] = [
  { slot: "whisper", label: "Speech-to-text", icon: Mic },
  { slot: "llm", label: "LLM", icon: MessageSquare },
  { slot: "tts", label: "Text-to-speech", icon: Volume2 },
];

interface ModelRowProps {
  label: string;
  icon: LucideIcon;
  selected: DeployedModel | null;
  options: DeployedModel[];
  onSelect: (id: string) => void;
}

function ModelRow({ label, icon: Icon, selected, options, onSelect }: ModelRowProps) {
  const { theme } = useTheme();
  const nameClass = cn(
    "text-xs truncate max-w-[100px]",
    theme === "dark" ? "text-gray-400" : "text-gray-500"
  );

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 shrink-0">
        <Icon className="w-3.5 h-3.5 text-TT-purple-accent" />
        <span className="text-xs whitespace-nowrap">{label}</span>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot connected={!!selected} />
        {options.length > 1 ? (
          <Select value={selected?.id} onValueChange={onSelect}>
            <SelectTrigger
              aria-label={`${label} model`}
              title={selected?.modelName}
              className="h-6 w-auto max-w-[110px] gap-1 border-none bg-transparent px-1.5 py-0 text-xs font-medium text-TT-purple-accent hover:bg-TT-purple-accent/10 focus:ring-0 [&>span]:truncate [&>svg]:h-3 [&>svg]:w-3"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {options.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  {m.modelName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className={nameClass} title={selected?.modelName}>
            {selected?.modelName || "None"}
          </span>
        )}
      </div>
    </div>
  );
}

export function StatusPanel({
  stage,
  models,
  modelOptions,
  onSelectModel,
  conversationId,
  messageCount,
}: StatusPanelProps) {
  const { theme } = useTheme();

  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-3 overflow-y-auto text-sm text-left",
        theme === "dark" ? "text-gray-300" : "text-gray-700"
      )}
    >
      {/* STATUS */}
      <section>
        <h3
          className={cn(
            "text-xs font-semibold uppercase tracking-wider mb-2",
            theme === "dark" ? "text-gray-500" : "text-gray-400"
          )}
        >
          Status
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-block w-2.5 h-2.5 rounded-full",
              stage === "idle" || stage === "done"
                ? "bg-TT-purple-accent"
                : stage === "recording"
                  ? "bg-TT-red-accent animate-pulse"
                  : "bg-TT-yellow animate-pulse"
            )}
          />
          <span className={cn("font-medium", STAGE_COLORS[stage])}>
            {STAGE_LABELS[stage]}
          </span>
        </div>
      </section>

      {/* MODELS */}
      <section>
        <h3
          className={cn(
            "text-xs font-semibold uppercase tracking-wider mb-2",
            theme === "dark" ? "text-gray-500" : "text-gray-400"
          )}
        >
          Models
        </h3>
        <div className="flex flex-col gap-2.5">
          {MODEL_ROWS.map(({ slot, label, icon }) => (
            <ModelRow
              key={slot}
              label={label}
              icon={icon}
              selected={models[slot]}
              options={modelOptions[slot]}
              onSelect={(id) => onSelectModel(slot, id)}
            />
          ))}
        </div>
      </section>

      {/* DEVICES */}
      <section>
        <h3
          className={cn(
            "text-xs font-semibold uppercase tracking-wider mb-2",
            theme === "dark" ? "text-gray-500" : "text-gray-400"
          )}
        >
          Devices
        </h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs">Microphone</span>
            <span
              className={cn(
                "text-xs",
                stage === "recording"
                  ? "text-red-500"
                  : theme === "dark"
                    ? "text-gray-400"
                    : "text-gray-500"
              )}
            >
              {stage === "recording" ? "Active" : "Ready"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Audio Output</span>
            <span
              className={cn(
                "text-xs",
                theme === "dark" ? "text-gray-400" : "text-gray-500"
              )}
            >
              Default
            </span>
          </div>
        </div>
      </section>

      {/* SESSION */}
      <section>
        <h3
          className={cn(
            "text-xs font-semibold uppercase tracking-wider mb-2",
            theme === "dark" ? "text-gray-500" : "text-gray-400"
          )}
        >
          Session
        </h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs">Conversation</span>
            <span
              className={cn(
                "text-xs font-mono",
                theme === "dark" ? "text-gray-400" : "text-gray-500"
              )}
            >
              {conversationId ? conversationId.slice(0, 8) : "--"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs">Messages</span>
            <span
              className={cn(
                "text-xs",
                theme === "dark" ? "text-gray-400" : "text-gray-500"
              )}
            >
              {messageCount}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
