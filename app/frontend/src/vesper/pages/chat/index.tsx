// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Gear } from "@tenstorrent/vesper/icons";
import { Select } from "@tenstorrent/vesper/select";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { Typography } from "@tenstorrent/vesper/typography";
import { fetchDeployedModelsInfo } from "@/src/api/modelsDeployedApis";
import { getTokenLimitsForModel } from "@/src/components/chatui/tokenLimits";
import type { RagDataSource } from "@/src/components/chatui/types";
import { useAgentAvailability } from "@/src/hooks/useAgentAvailability";
import { useDeviceState } from "@/src/hooks/useDeviceState";
import { KnowledgeBasePicker } from "@/src/vesper/components/knowledge-base-picker";
import { ModelLogo } from "@/src/vesper/components/model-logo";
import { useHealthyModels } from "@/src/vesper/hooks/use-healthy-models";
import { Composer } from "./components/composer";
import { EmptyChat } from "./components/empty-chat";
import { HistoryPanel } from "./components/history-panel";
import { MessageList } from "./components/message-list";
import { SettingsSheet } from "./components/settings-sheet";
import { DEFAULT_SETTINGS, useChat, type ModelSettings } from "./use-chat";

export default function ChatPage() {
  const chatModels = useHealthyModels(["chat", "vlm"]);
  const sttModels = useHealthyModels("speech_recognition");
  const model = chatModels.selected;
  const { deviceState } = useDeviceState();

  const [ragDatasource, setRagDatasource] = useState<
    RagDataSource | undefined
  >();
  const [settings, setSettings] = useState<ModelSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // per-model capabilities: thinking, token limits, vision
  const deployedInfo = useQuery({
    queryKey: ["deployed-models-info"],
    queryFn: fetchDeployedModelsInfo,
    refetchInterval: 30_000,
  });
  const info = deployedInfo.data?.find((m) => m.id === model?.id);
  const supportsThinking = !!info?.thinking_toggle;
  const allowImages = (info?.model_type ?? "").toLowerCase() === "vlm";
  const { defaultMaxTokens, sliderMax } = getTokenLimitsForModel(
    info?.model_impl?.param_count,
    info?.max_model_len
  );
  useEffect(() => {
    setSettings((prev) => ({ ...prev, maxTokens: defaultMaxTokens }));
  }, [defaultMaxTokens, model?.id]);

  const { isAgentAvailable } = useAgentAvailability(model?.id ?? null);

  const hardwareContext = useMemo(() => {
    if (!deviceState || deviceState.state === "NOT_PRESENT") return null;
    const name =
      deviceState.board_name &&
      deviceState.board_name.toLowerCase() !== "unknown"
        ? deviceState.board_name
        : null;
    return name ? `Tenstorrent hardware (${name})` : "Tenstorrent hardware";
  }, [deviceState]);

  const chat = useChat({
    modelId: model?.id ?? null,
    modelName: model?.modelName ?? null,
    hardwareContext,
    ragDatasource,
    settings: {
      ...settings,
      searchAgent: settings.searchAgent && isAgentAvailable,
    },
    supportsThinking,
  });
  const messages = chat.thread.messages ?? [];

  return (
    <div className="h-full flex text-left">
      <HistoryPanel
        threads={chat.threads}
        currentId={chat.thread.id}
        onSelect={chat.selectThread}
        onDelete={chat.deleteThread}
        onNewChat={chat.startNewChat}
      />
      <div className="flex-1 min-w-0 h-full flex flex-col">
        <div className="h-16 shrink-0 flex items-center gap-vesper-4 px-vesper-6 border-b border-vesper-border-tertiary bg-vesper-background-primary">
          {chatModels.models.length > 1 ? (
            <Select
              size="sm"
              className="w-72"
              aria-label="Chat model"
              icon={
                <ModelLogo
                  modelName={model?.modelName}
                  hfModelId={model?.hfModelId}
                  className="w-4 h-4"
                />
              }
              options={chatModels.models.map((m) => ({
                value: m.id,
                label: m.modelName,
              }))}
              value={model?.id ?? null}
              onValueChange={(id) => id && chatModels.setSelectedId(id)}
            />
          ) : (
            <div className="flex items-center gap-vesper-3 min-w-0">
              {model && (
                <ModelLogo
                  modelName={model.modelName}
                  hfModelId={model.hfModelId}
                  className="w-5 h-5"
                />
              )}
              <Typography
                variant="label-md"
                className="truncate text-vesper-text-primary"
              >
                {model?.modelName ??
                  (chatModels.isLoading
                    ? "Loading models…"
                    : "No chat model is ready")}
              </Typography>
            </div>
          )}
          <div className="ml-auto flex items-center gap-vesper-3">
            <KnowledgeBasePicker
              className="w-56"
              value={ragDatasource}
              onChange={setRagDatasource}
            />
            <Tooltip content="Model parameters">
              <IconButton
                type="button"
                size="sm"
                variant="ghost"
                icon={<Gear />}
                aria-label="Model parameters"
                onClick={() => setSettingsOpen(true)}
              />
            </Tooltip>
          </div>
        </div>

        {messages.length === 0 ? (
          <EmptyChat
            disabled={!model}
            onPick={(prompt) => void chat.send(prompt)}
          />
        ) : (
          <MessageList
            messages={messages}
            streaming={chat.streaming}
            onRegenerate={() => void chat.regenerate()}
          />
        )}

        <Composer
          modelName={model?.modelName ?? null}
          disabled={!model}
          streaming={chat.streaming}
          allowImages={allowImages}
          sttModelId={sttModels.models[0]?.id ?? null}
          onSend={(text, files) => void chat.send(text, files)}
          onStop={chat.stop}
        />
      </div>

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={setSettings}
        maxTokensLimit={sliderMax}
        supportsThinking={supportsThinking}
        searchAgentAvailable={isAgentAvailable}
      />
    </div>
  );
}
