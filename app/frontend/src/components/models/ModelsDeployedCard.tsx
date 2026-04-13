// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
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
import HealthCell from "./row-cells/HealthCell";
import ModelPreparingBanner from "./ModelPreparingBanner";
import ActiveDeploymentBanner from "./ActiveDeploymentBanner";
import NoModelsRunning from "./NoModelsRunning";
import ModelReadyGuide, { GUIDE_KEY } from "../tour/ModelReadyGuide";
import { safeGetItem } from "../../lib/storage";
import { customToast } from "../CustomToaster";
import { ModelsDeployedSkeleton } from "../ModelsDeployedSkeleton";
import { useModels } from "../../hooks/useModels";
import { useRefresh } from "../../hooks/useRefresh";
import { useHealthRefresh } from "../../hooks/useHealthRefresh";
import { useOpenLogsFromUrl } from "../../hooks/useOpenLogsFromUrl";
import { useColumnPrefs } from "../../hooks/useColumnPrefs";
import {
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
import DeleteModelDialog from "./DeleteModelDialog.tsx";
import LogStreamDialog from "./Logs/LogStreamDialog.tsx";
import RegisterModelDialog from "./RegisterModelDialog.tsx";
import { useNavigate } from "react-router-dom";
import { useTablePrefs } from "../../hooks/useTablePrefs";
import { useDeleteStream } from "../../hooks/useDeleteStream";
import axios from "axios";
import { ChipStatusDisplay } from "../ChipStatusDisplay";

export default function ModelsDeployedCard(): JSX.Element {
  const { models, setModels, refreshModels, userStoppedModel, setUserStoppedModel } = useModels();
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
  const [showGuide, setShowGuide] = useState(false);

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
  const deleteStream = useDeleteStream();

  useEffect(() => {
    loadModels();
  }, [loadModels, refreshTrigger]);

  const [healthMap, setHealthMap] = useState<Record<string, HealthStatus>>({});
  const [preparingBannerDismissed, setPreparingBannerDismissed] = useState(false);

  // Auto-refresh model list when any model becomes unavailable/unknown
  // (container likely stopped or crashed). Uses a ref so the timer
  // isn't torn down every time healthMap changes from polling.
  const staleRefreshTimer = useRef<number | null>(null);
  const hasStaleModel = useMemo(
    () => Object.values(healthMap).some((h) => h === "unavailable" || h === "unknown"),
    [healthMap],
  );

  useEffect(() => {
    if (hasStaleModel && !showDeleteModal && !staleRefreshTimer.current) {
      staleRefreshTimer.current = window.setTimeout(() => {
        staleRefreshTimer.current = null;
        setUserStoppedModel(false);
        loadModels();
      }, 5000);
    }
    if (!hasStaleModel && staleRefreshTimer.current) {
      clearTimeout(staleRefreshTimer.current);
      staleRefreshTimer.current = null;
    }
  }, [hasStaleModel, showDeleteModal, loadModels, setUserStoppedModel]);

  const rows: ModelRow[] = useMemo(() => models as ModelRow[], [models]);

  const preparingModels = useMemo(() => {
    return rows.filter((r) => healthMap[r.id] === "starting");
  }, [rows, healthMap]);

  const showVoiceBanner = useMemo(() => {
    if (voiceBannerDismissed) return false;
    const getType = (m: (typeof models)[number]) =>
      m.model_type
        ? getModelTypeFromBackendType(m.model_type)
        : getModelTypeFromName(m.name, m.image);

    const llmModel = models.find((m) => {
      const t = getType(m);
      return t === ModelType.ChatModel || t === ModelType.VLM;
    });
    const sttModel = models.find(
      (m) => getType(m) === ModelType.SpeechRecognitionModel
    );
    const ttsModel = models.find((m) => getType(m) === ModelType.TTS);

    if (!llmModel || !sttModel || !ttsModel) return false;

    // Only show once all three are confirmed healthy
    return (
      healthMap[llmModel.id] === "healthy" &&
      healthMap[sttModel.id] === "healthy" &&
      healthMap[ttsModel.id] === "healthy"
    );
  }, [models, healthMap, voiceBannerDismissed]);

  const handleRetry = () => {
    setLoading(true);
    loadModels();
  };

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTargetId) return;
    deleteStream.start(deleteTargetId);
  }, [deleteTargetId, deleteStream]);

  const handleCloseDeleteModal = useCallback(() => {
    if (deleteStream.status === "running") return;

    const finished = deleteStream.status === "success" || deleteStream.status === "partial" || deleteStream.status === "error";
    if (finished) {
      if (deleteStream.status === "success" || deleteStream.status === "partial") {
        localStorage.setItem("hasEverDeployed", "true");
        setUserStoppedModel(true);
      }
      refreshModels();
      triggerHardwareRefresh();
      window.setTimeout(() => refreshAllHealth(), 1000);
    }

    setShowDeleteModal(false);
    setDeleteTargetId(null);
    deleteStream.reset();
  }, [deleteStream, refreshModels, triggerHardwareRefresh, refreshAllHealth]);

  // Auto-close the dialog once deletion finishes successfully
  const autoCloseTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (deleteStream.status === "success" && showDeleteModal) {
      localStorage.setItem("hasEverDeployed", "true");
      setUserStoppedModel(true);
      autoCloseTimerRef.current = window.setTimeout(() => {
        refreshModels();
        triggerHardwareRefresh();
        window.setTimeout(() => refreshAllHealth(), 1000);
        setShowDeleteModal(false);
        setDeleteTargetId(null);
        deleteStream.reset();
      }, 1500);
    }
    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
    };
  // Only re-run when status changes, not on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteStream.status]);

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
    return <NoModelsRunning userStopped={userStoppedModel} />;
  }

  return (
    <>
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
            onOpenGuide={() => setShowGuide(true)}
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

      {/* Active deployment progress banner — shown while a model is still deploying */}
      <ActiveDeploymentBanner
        onComplete={() => {
          loadModels();
          if (!localStorage.getItem(GUIDE_KEY)) {
            setShowGuide(true);
          }
        }}
      />

      {/* Model preparing banner */}
      {!preparingBannerDismissed && preparingModels.length > 0 && (
        <ModelPreparingBanner
          models={preparingModels}
          onDismiss={() => setPreparingBannerDismissed(true)}
        />
      )}

      {/* Chip slot visualization for multi-chip boards (hidden on QB2/P300Cx2) */}
      {isMultiChipBoard && chipStatus && chipStatus.board_type !== "P300Cx2" && (
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
                hideDeviceId={chipStatus?.board_type === "P300Cx2"}
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
        isLoading={deleteStream.status === "running"}
        deleteStep={deleteStream.step}
        streamStatus={deleteStream.status}
        stepLogs={deleteStream.stepLogs}
        errorMessage={deleteStream.errorMessage}
        onConfirm={handleConfirmDelete}
        onCancel={handleCloseDeleteModal}
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

    <ModelReadyGuide open={showGuide} onClose={() => setShowGuide(false)} />

    {/* Hidden HealthCell container — keeps health polling alive without rendering in the table */}
    <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", visibility: "hidden" }}>
      {rows.map((row) => (
        <Fragment key={row.id}>
          <HealthCell
            id={row.id}
            register={mirroredRegister}
            onHealthChange={(id: string, h: HealthStatus) =>
              setHealthMap((prev) => ({ ...prev, [id]: h }))
            }
          />
        </Fragment>
      ))}
    </div>
    </>
  );
}
