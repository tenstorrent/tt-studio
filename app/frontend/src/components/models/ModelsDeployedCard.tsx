// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import ElevatedCard from "../ui/elevated-card";
import { CardContent, CardHeader, CardTitle } from "../ui/card";
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import { Table } from "../ui/table";
import { Button } from "../ui/button";
import { EnhancedButton } from "../ui/enhanced-button";
import { PulsatingDot } from "../ui/pulsating-dot";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { AlertCircle, Plus } from "lucide-react";
import { customToast } from "../CustomToaster";
import { ModelsDeployedSkeleton } from "../ModelsDeployedSkeleton";
import { NoModelsDialog } from "../NoModelsDeployed";
import { useModels } from "../../hooks/useModels";
import { useRefresh } from "../../hooks/useRefresh";
import { useHealthRefresh } from "../../hooks/useHealthRefresh";
import { useOpenLogsFromUrl } from "../../hooks/useOpenLogsFromUrl";
import { useColumnPrefs } from "../../hooks/useColumnPrefs";
import {
  deleteModel,
  handleRedeploy,
  handleModelNavigationClick,
  fetchModels,
  fetchDeployedModelsInfo,
  getModelTypeFromBackendType,
  ModelType,
  getModelTypeFromName,
} from "../../api/modelsDeployedApis";
import type {
  ColumnVisibilityMap,
  HealthStatus,
  ModelRow,
} from "../../types/models";
import ModelsToolbar from "./ModelsToolbar.tsx";
import ModelsTable from "./ModelsTable.tsx";
import DeleteModelDialog, { type DeleteStep } from "./DeleteModelDialog.tsx";
import LogStreamDialog from "./Logs/LogStreamDialog.tsx";
import RegisterModelDialog from "./RegisterModelDialog.tsx";
import { useNavigate } from "react-router-dom";
import { useTablePrefs } from "../../hooks/useTablePrefs";
import axios from "axios";
import { ChipStatusDisplay } from "../ChipStatusDisplay";

export default function ModelsDeployedCard(): JSX.Element {
  const { models, setModels, refreshModels } = useModels();
  const { refreshTrigger, triggerRefresh, triggerHardwareRefresh } =
    useRefresh();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Chip slot status for multi-chip boards
  const [chipStatus, setChipStatus] = useState<{
    board_type: string;
    total_slots: number;
    slots: { slot_id: number; status: string; model_name?: string; deployment_id?: number; is_multi_chip?: boolean }[];
  } | null>(null);

  useEffect(() => {
    const fetchChipStatus = () => {
      axios
        .get("/docker-api/chip-status/")
        .then((res) => setChipStatus(res.data))
        .catch(() => setChipStatus(null));
    };
    fetchChipStatus();
    const interval = setInterval(fetchChipStatus, 7 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshTrigger]);

  const isMultiChipBoard = chipStatus !== null && chipStatus.total_slots > 1;

  const { isRefreshing, refreshAllHealth, register } = useHealthRefresh();
  const {
    value: columns,
    setKey,
    setPreset,
  } = useColumnPrefs("models-deployed", {
    containerId: true,
    image: false,
    ports: true,
  });

  const navigate = useNavigate();
  const [voiceBannerDismissed, setVoiceBannerDismissed] = useState(false);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);

  const loadModels = useCallback(async () => {
    setLoadError(null);
    try {
      const fetched = await fetchModels();
      const deployedInfo = await fetchDeployedModelsInfo();
      const typeById = Object.fromEntries(deployedInfo.map(d => [d.id, d.model_type]));
      const enriched = fetched.map(m => ({ ...m, model_type: m.model_type ?? typeById[m.id] }));
      setModels(enriched);
      if (fetched.length === 0) {
        triggerRefresh();
      }
    } catch (error) {
      let errorMessage = "Failed to fetch models. Check network connection.";
      if (error instanceof Error) {
        errorMessage = `Failed to fetch models: ${error.message}`;
      }
      setLoadError(errorMessage);
      customToast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [setModels, triggerRefresh]);

  // Density/refresh prefs
  const { prefs, setDensity, setAutoRefreshSec, setHealthRefreshSec } =
    useTablePrefs("models-deployed", {
      density: "normal",
      autoRefreshSec: 0,
      healthRefreshSec: 0,
    });

  // Auto-refresh timer for data
  const autoRefreshTimer = useRef<number | null>(null);
  useEffect(() => {
    if (autoRefreshTimer.current) {
      window.clearInterval(autoRefreshTimer.current);
      autoRefreshTimer.current = null;
    }
    if (prefs.autoRefreshSec > 0) {
      autoRefreshTimer.current = window.setInterval(() => {
        loadModels();
      }, prefs.autoRefreshSec * 1000) as unknown as number;
    }
    return () => {
      if (autoRefreshTimer.current) {
        window.clearInterval(autoRefreshTimer.current);
      }
    };
  }, [prefs.autoRefreshSec, loadModels]);

  // Auto health refresh timer
  const healthTimer = useRef<number | null>(null);
  useEffect(() => {
    if (healthTimer.current) {
      window.clearInterval(healthTimer.current);
      healthTimer.current = null;
    }
    if (prefs.healthRefreshSec > 0) {
      healthTimer.current = window.setInterval(() => {
        refreshAllHealth();
      }, prefs.healthRefreshSec * 1000) as unknown as number;
    }
    return () => {
      if (healthTimer.current) {
        window.clearInterval(healthTimer.current);
      }
    };
  }, [prefs.healthRefreshSec, refreshAllHealth]);

  // Logs dialog state
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(
    null
  );
  useOpenLogsFromUrl(!!selectedContainerId, setSelectedContainerId);

  // Delete state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isProcessingDelete, setIsProcessingDelete] = useState(false);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>(null);

  useEffect(() => {
    loadModels();
  }, [loadModels, refreshTrigger]);

  const [healthMap, setHealthMap] = useState<Record<string, HealthStatus>>({});

  const rows: ModelRow[] = useMemo(() => models as ModelRow[], [models]);

  const showVoiceBanner = useMemo(() => {
    if (voiceBannerDismissed) return false;
    const deployedTypes = models.map((m) =>
      m.model_type
        ? getModelTypeFromBackendType(m.model_type)
        : getModelTypeFromName(m.name, m.image)
    );
    const hasLLM = deployedTypes.some(
      (t) => t === ModelType.ChatModel || t === ModelType.VLM
    );
    const hasSTT = deployedTypes.some(
      (t) => t === ModelType.SpeechRecognitionModel
    );
    const hasTTS = deployedTypes.some((t) => t === ModelType.TTS);
    return hasLLM && hasSTT && hasTTS;
  }, [models, voiceBannerDismissed]);

  const handleRetry = () => {
    setLoading(true);
    loadModels();
  };

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTargetId) return;
    setIsProcessingDelete(true);
    const truncatedModelId = deleteTargetId.substring(0, 4);
    try {
      // Step 1: stop & remove the model (backend also runs tt-smi -r internally)
      setDeleteStep("deleting");
      await customToast.promise(deleteModel(deleteTargetId), {
        loading: `Stopping model ${truncatedModelId}…`,
        success: `Model ${truncatedModelId} stopped.`,
        error: `Failed to stop model ${truncatedModelId}.`,
      });

      // Step 2: board reset is handled by the stop API, show progress while cleanup settles
      setDeleteStep("resetting");
      await new Promise((resolve) => window.setTimeout(resolve, 2000));

      await refreshModels();
      triggerHardwareRefresh();
      setShowDeleteModal(false);
      setDeleteTargetId(null);
      window.setTimeout(() => {
        refreshAllHealth();
      }, 1000);
    } finally {
      setIsProcessingDelete(false);
      setDeleteStep(null);
    }
  }, [deleteTargetId, refreshModels, triggerHardwareRefresh, refreshAllHealth]);

  const exportVisible = useCallback(() => {
    const visibleRows = rows.map((r) => ({
      id: r.id,
      name: r.name,
      image: (columns.image && r.image) || undefined,
      ports: (columns.ports && r.ports) || undefined,
      status: r.status,
    }));
    const blob = new Blob([JSON.stringify(visibleRows, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "models-visible.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, columns]);

  const copyAllVisible = useCallback(() => {
    const text = rows
      .map((r) => {
        const parts = [
          `id: ${r.id}`,
          `name: ${r.name}`,
          columns.image ? `image: ${r.image}` : undefined,
          `status: ${r.status}`,
          columns.ports ? `ports: ${r.ports}` : undefined,
        ].filter(Boolean);
        return parts.join(" | ");
      })
      .join("\n");
    navigator.clipboard.writeText(text);
    customToast.success("Copied visible table data");
  }, [rows, columns]);

  const refreshHealthById = useCallback(
    (id: string) => {
      // delegate to registered ref using the provided register function's internal map
      // augment register with a weak map for direct lookup
      // We maintain our own map as well by listening to register callbacks
      // Since useHealthRefresh keeps refs internally, add a minimal mirror
      const anyRegister: any = register;
      if (!anyRegister._refsMirror) return;
      const node = anyRegister._refsMirror.get(id);
      if (node && typeof node.refreshHealth === "function")
        node.refreshHealth();
    },
    [register]
  );

  // Wrap the register to keep a mirror map for quick lookups
  const mirroredRegister = useCallback(
    (id: string, node: any | null) => {
      const anyRegister: any = register;
      if (!anyRegister._refsMirror) anyRegister._refsMirror = new Map();
      if (node) {
        anyRegister._refsMirror.set(id, node);
      } else {
        anyRegister._refsMirror.delete(id);
      }
      register(id, node);
    },
    [register]
  );

  if (loading) {
    return <ModelsDeployedSkeleton />;
  }

  if (loadError) {
    return (
      <div className="border-0 shadow-none p-8 bg-transparent">
        <div className="flex flex-col items-center justify-center gap-4">
          <AlertCircle className="w-16 h-16 text-red-500" />
          <h2 className="text-2xl font-semibold">Connection Error</h2>
          <p className="text-center text-gray-600 dark:text-gray-300 max-w-md">
            {loadError}
          </p>
          <Button
            onClick={handleRetry}
            className="mt-4 bg-blue-500 hover:bg-blue-600 text-white"
          >
            Retry Connection
          </Button>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return <NoModelsDialog messageKey="reset" />;
  }

  return (
    <ElevatedCard accent="neutral" depth="lg" hover>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-3">
          {/* Left */}
          <CardTitle className="text-xl">Models Deployed</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRegisterDialog(true)}
          >
            <Plus className="w-4 h-4 mr-1" />
            Register Model
          </Button>
          {/* Center intentionally empty per redesign */}
          <div className="flex-1" />
          {/* Right */}
          <ModelsToolbar
            tableId="models-deployed"
            visibleMap={columns}
            onToggle={setKey}
            onPreset={setPreset}
            isRefreshing={isRefreshing}
            onRefresh={refreshAllHealth}
            density={prefs.density}
            onDensity={setDensity}
            autoRefreshSec={prefs.autoRefreshSec}
            onAutoRefreshSec={setAutoRefreshSec}
            healthRefreshSec={prefs.healthRefreshSec}
            onHealthRefreshSec={setHealthRefreshSec}
            onExportVisible={exportVisible}
            onCopyAll={copyAllVisible}
            visibleCount={Object.values(columns).filter(Boolean).length}
            totalCount={Object.keys(columns).length}
            onRefreshHealthNow={refreshAllHealth}
          />
        </div>
      </CardHeader>

      {/* Voice Agent discovery banner */}
      {showVoiceBanner && (
        <TooltipProvider>
          <ElevatedCard accent="blue" depth="md" className="mx-6 mb-6">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2">
                        <PulsatingDot label="Whisper STT" color="blue" size="md" delay={0} />
                        <PulsatingDot label="LLM" color="green" size="md" delay={400} />
                        <PulsatingDot label="TTS" color="purple" size="md" delay={800} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p className="text-sm">
                        TT Studio automatically chains your deployed models: Whisper STT → LLM → TTS for seamless voice conversations
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">Voice Agent Ready</h3>
                    <p className="text-sm text-muted-foreground">
                      3 models deployed and auto-chained
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <EnhancedButton 
                    variant="default" 
                    effect="shine"
                    onClick={() => navigate("/voice-agent")}
                  >
                    Start Voice Chat
                  </EnhancedButton>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => setVoiceBannerDismissed(true)}
                    aria-label="Dismiss"
                  >
                    ✕
                  </Button>
                </div>
              </div>
            </CardContent>
          </ElevatedCard>
        </TooltipProvider>
      )}

      {/* Chip slot visualization for multi-chip boards */}
      {isMultiChipBoard && chipStatus && (
        <div className="px-6 pb-4">
          <ChipStatusDisplay
            boardType={chipStatus.board_type}
            totalSlots={chipStatus.total_slots}
            slots={chipStatus.slots as any}
          />
        </div>
      )}

      <div
        className={`${selectedContainerId ? "blur-sm backdrop-blur-sm" : ""} transition-all duration-200`}
      >
        <CardContent className="p-0">
          <ScrollArea className="whitespace-nowrap rounded-md">
            <Table>
              <ModelsTable
                rows={rows}
                visibleMap={columns as ColumnVisibilityMap}
                healthMap={healthMap}
                onOpenLogs={(id: string) => setSelectedContainerId(id)}
                onDelete={(id: string) => {
                  setDeleteTargetId(id);
                  setShowDeleteModal(true);
                }}
                onRedeploy={(image?: string) => image && handleRedeploy(image)}
                onNavigateToModel={(id: string, name: string) => {
                  const row = rows.find((r) => r.id === id);
                  const frontendType = row?.model_type
                    ? getModelTypeFromBackendType(row.model_type)
                    : undefined;
                  handleModelNavigationClick(id, name, navigate, frontendType);
                }}
                onOpenApi={(id: string) => {
                  const encoded = encodeURIComponent(id);
                  window.location.href = `/api-info/${encoded}`;
                }}
                registerHealthRef={mirroredRegister}
                onHealthChange={(id: string, h: HealthStatus) =>
                  setHealthMap((prev) => ({ ...prev, [id]: h }))
                }
                refreshHealthById={refreshHealthById}
                density={prefs.density}
              />
            </Table>
            <ScrollBar
              className="scrollbar-thumb-rounded"
              orientation="horizontal"
            />
          </ScrollArea>
        </CardContent>
      </div>

      <LogStreamDialog
        open={!!selectedContainerId}
        containerId={selectedContainerId || ""}
        modelName={
          models.find((m) => m.id === selectedContainerId)?.name || undefined
        }
        onClose={() => setSelectedContainerId(null)}
      />

      <DeleteModelDialog
        open={showDeleteModal}
        modelId={deleteTargetId || ""}
        isLoading={isProcessingDelete}
        deleteStep={deleteStep}
        onConfirm={handleConfirmDelete}
        onCancel={() => !isProcessingDelete && setShowDeleteModal(false)}
      />

      <RegisterModelDialog
        open={showRegisterDialog}
        onClose={() => setShowRegisterDialog(false)}
        onSuccess={() => {
          setShowRegisterDialog(false);
          loadModels();
        }}
      />
    </ElevatedCard>
  );
}
