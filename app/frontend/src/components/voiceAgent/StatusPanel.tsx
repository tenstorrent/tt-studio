// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { cn } from "../../lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { Mic, Volume2, MessageSquare } from "lucide-react";
import type { PipelineStage, DeployedModelState } from "./types";

interface StatusPanelProps {
  stage: PipelineStage;
  models: DeployedModelState;
  conversationId: string | null;
  messageCount: number;
}

const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: "Idle",
  recording: "Recording",
  transcribing: "Transcribing",
  thinking: "Thinking",
  speaking: "Speaking",
  done: "Done",
};

const STAGE_COLORS: Record<PipelineStage, string> = {
  idle: "text-TT-purple-accent",
  recording: "text-TT-red-accent",
  transcribing: "text-TT-yellow",
  thinking: "text-TT-yellow",
  speaking: "text-TT-green",
  done: "text-TT-purple-accent",
};

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full",
        connected ? "bg-green-500" : "bg-gray-400"
      )}
    />
  );
}

export function StatusPanel({
  stage,
  models,
  conversationId,
  messageCount,
}: StatusPanelProps) {
  const { theme } = useTheme();

  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-3 overflow-y-auto text-sm",
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mic className="w-3.5 h-3.5 text-TT-purple-accent" />
              <span className="text-xs">Whisper</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusDot connected={!!models.whisper} />
              <span
                className={cn(
                  "text-xs truncate max-w-[100px]",
                  theme === "dark" ? "text-gray-400" : "text-gray-500"
                )}
                title={models.whisper?.modelName}
              >
                {models.whisper?.modelName || "None"}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-TT-purple-accent" />
              <span className="text-xs">LLM</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusDot connected={!!models.llm} />
              <span
                className={cn(
                  "text-xs truncate max-w-[100px]",
                  theme === "dark" ? "text-gray-400" : "text-gray-500"
                )}
                title={models.llm?.modelName}
              >
                {models.llm?.modelName || "None"}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5 text-TT-purple-accent" />
              <span className="text-xs">TTS</span>
            </div>
            <div className="flex items-center gap-1.5">
              <StatusDot connected={!!models.tts} />
              <span
                className={cn(
                  "text-xs truncate max-w-[100px]",
                  theme === "dark" ? "text-gray-400" : "text-gray-500"
                )}
                title={models.tts?.modelName}
              >
                {models.tts?.modelName || "None"}
              </span>
            </div>
          </div>
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
