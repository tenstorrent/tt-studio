// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../components/ui/resizable";
import { Code2, Eye, MessageSquare } from "lucide-react";
import { fetchModels } from "../api/modelsDeployedApis";
import type { Model } from "../contexts/ModelsContext";
import CanvasChat from "../components/canvas/CanvasChat";
import CanvasCodeView from "../components/canvas/CanvasCodeView";
import CanvasPreview from "../components/canvas/CanvasPreview";
import { useCanvasState } from "../components/canvas/useCanvasState";

type VisiblePanel = "chat" | "code" | "preview";

export default function CanvasPage() {
  const location = useLocation();
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [visiblePanels, setVisiblePanels] = useState<Set<VisiblePanel>>(
    new Set(["chat", "code", "preview"]),
  );

  const isDeployedEnabled =
    import.meta.env.VITE_ENABLE_DEPLOYED === "true";

  useEffect(() => {
    if (location.state?.containerID) {
      setModelId(location.state.containerID);
      if (location.state?.modelName) {
        setModelName(location.state.modelName);
      }
    } else if (!isDeployedEnabled) {
      fetchModels()
        .then((models: Model[]) => {
          if (models.length > 0) {
            setModelId(models[0].id || null);
            setModelName(models[0].name || null);
          }
        })
        .catch(() => {});
    }
  }, [location.state, isDeployedEnabled]);

  const {
    messages,
    currentCode,
    isStreaming,
    streamingText,
    streamingThinking,
    previewErrors,
    creativity,
    setCreativity,
    sendMessage,
    stopStreaming,
    resetCanvas,
    setPreviewErrors,
  } = useCanvasState(modelId, false);

  const togglePanel = (panel: VisiblePanel) => {
    setVisiblePanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel) && next.size > 1) {
        next.delete(panel);
      } else {
        next.add(panel);
      }
      return next;
    });
  };

  const panelDefaults = useMemo(() => {
    const count = visiblePanels.size;
    if (count === 3) return { chat: 25, code: 37, preview: 38 };
    if (count === 2) return { chat: 35, code: 50, preview: 50 };
    return { chat: 100, code: 100, preview: 100 };
  }, [visiblePanels.size]);

  return (
    <div className="fixed inset-0 w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2]">
      <div
        className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
        style={{
          maskImage:
            "radial-gradient(ellipse at center, transparent 95%, black 100%)",
        }}
      />
      <div
        className="w-full h-full lg:pl-16 overflow-hidden flex flex-col"
        style={{ paddingBottom: "var(--footer-height, 0px)" }}
      >
        {/* Panel toggle toolbar */}
        <div className="flex items-center justify-center gap-1 py-1.5 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm z-10 shrink-0">
          <PanelToggle
            icon={<MessageSquare className="w-3.5 h-3.5" />}
            label="Chat"
            active={visiblePanels.has("chat")}
            onClick={() => togglePanel("chat")}
          />
          <PanelToggle
            icon={<Code2 className="w-3.5 h-3.5" />}
            label="Code"
            active={visiblePanels.has("code")}
            onClick={() => togglePanel("code")}
          />
          <PanelToggle
            icon={<Eye className="w-3.5 h-3.5" />}
            label="Preview"
            active={visiblePanels.has("preview")}
            onClick={() => togglePanel("preview")}
          />
        </div>

        {/* Resizable panels */}
        <div className="grow min-h-0">
          <ResizablePanelGroup
            direction="horizontal"
            className="h-full"
          >
            {visiblePanels.has("chat") && (
              <>
                <ResizablePanel
                  defaultSize={panelDefaults.chat}
                  minSize={15}
                  className="bg-white dark:bg-zinc-900"
                >
                  <CanvasChat
                    messages={messages}
                    isStreaming={isStreaming}
                    streamingText={streamingText}
                    streamingThinking={streamingThinking}
                    onSend={sendMessage}
                    onStop={stopStreaming}
                    onReset={resetCanvas}
                    hasCode={!!currentCode}
                    modelId={modelId}
                    isCloudMode={isDeployedEnabled}
                    modelName={isDeployedEnabled ? (import.meta.env.VITE_CANVAS_MODEL || "Llama-3.3-70B") : modelName}
                    creativity={creativity}
                    onCreativityChange={setCreativity}
                  />
                </ResizablePanel>
                {(visiblePanels.has("code") ||
                  visiblePanels.has("preview")) && (
                  <ResizableHandle withHandle />
                )}
              </>
            )}

            {visiblePanels.has("code") && (
              <>
                <ResizablePanel
                  defaultSize={panelDefaults.code}
                  minSize={15}
                  className="bg-[#0d1117]"
                >
                  <CanvasCodeView
                    code={currentCode}
                    streamingText={streamingText}
                    streamingThinking={streamingThinking}
                    isStreaming={isStreaming}
                  />
                </ResizablePanel>
                {visiblePanels.has("preview") && (
                  <ResizableHandle withHandle />
                )}
              </>
            )}

            {visiblePanels.has("preview") && (
              <ResizablePanel
                defaultSize={panelDefaults.preview}
                minSize={15}
                className="bg-white dark:bg-zinc-900"
              >
                <CanvasPreview
                  code={currentCode}
                  isStreaming={isStreaming}
                  errors={previewErrors}
                  onError={setPreviewErrors}
                />
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        </div>
      </div>
    </div>
  );
}

function PanelToggle({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
        active
          ? "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800"
          : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-transparent"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
