// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  Loader2,
  RefreshCw,
  ChevronDown,
  Info,
  AlertTriangle,
  Cpu,
  Layers,
  Sparkles,
} from "lucide-react";
import { customToast } from "../CustomToaster";
import {
  discoverContainers,
  registerExternalModel,
  fetchModelCatalog,
  type DiscoveredContainer,
  type CatalogModel,
} from "../../api/modelsDeployedApis";
import { useDetectModel } from "../../hooks/useDetectModel";
import { parseVllmLogs } from "../../utils/parseVllmLogs";

export interface RegisterModelFormContentProps {
  onSuccess: () => void;
  /** If provided, a Cancel button is shown that calls this handler. */
  onCancel?: () => void;
}

const MODEL_TYPE_OPTIONS = [
  { value: "chat", label: "Chat (LLM)" },
  { value: "vlm", label: "VLM (Vision-Language)" },
  { value: "tts", label: "Text-to-Speech" },
  { value: "speech_recognition", label: "Speech-to-Text" },
  { value: "image_generation", label: "Image Generation" },
  { value: "video_generation", label: "Video Generation" },
  { value: "embedding", label: "Embedding" },
  { value: "cnn", label: "CNN" },
  { value: "object_detection", label: "Object Detection" },
] as const;

const DEFAULT_ROUTES: Record<string, string> = {
  chat: "/v1/chat/completions",
  vlm: "/v1/chat/completions",
  embedding: "/v1/chat/completions",
  tts: "/v1/audio/speech",
  speech_recognition: "/v1/audio/transcriptions",
  image_generation: "/v1/images/generations",
  video_generation: "/v1/chat/completions",
  object_detection: "/v1/chat/completions",
  cnn: "/v1/chat/completions",
};

interface ChipSlot {
  slot_id: number;
  status: "available" | "occupied";
  model_name?: string;
  deployment_id?: number;
  is_multi_chip?: boolean;
}

interface ChipStatus {
  board_type: string;
  total_slots: number;
  slots: ChipSlot[];
}

function extractFirstPort(
  portBindings: DiscoveredContainer["port_bindings"]
): number | null {
  if (!portBindings) return null;
  for (const key of Object.keys(portBindings)) {
    try {
      return parseInt(key.split("/")[0], 10);
    } catch {
      continue;
    }
  }
  return null;
}

function getExposedPorts(
  portBindings: DiscoveredContainer["port_bindings"]
): number[] {
  if (!portBindings) return [];
  const ports: number[] = [];
  for (const key of Object.keys(portBindings)) {
    try {
      ports.push(parseInt(key.split("/")[0], 10));
    } catch {
      continue;
    }
  }
  return ports;
}

export default function RegisterModelFormContent({
  onSuccess,
  onCancel,
}: RegisterModelFormContentProps) {
  // Container discovery
  const [containers, setContainers] = useState<DiscoveredContainer[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);

  // Catalog for HF model ID matching
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);

  // Chip status
  const [chipStatus, setChipStatus] = useState<ChipStatus | null>(null);
  const [loadingChipStatus, setLoadingChipStatus] = useState(false);

  // Form state
  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [modelType, setModelType] = useState("");
  const [modelName, setModelName] = useState("");
  const [hfModelId, setHfModelId] = useState("");
  const [servicePort, setServicePort] = useState("7000");
  const [serviceRoute, setServiceRoute] = useState("/v1/chat/completions");
  const [healthRoute, setHealthRoute] = useState("/health");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Device selection state
  const [chipsRequired, setChipsRequired] = useState<1 | 4>(1);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);

  // Catalog match banner
  const [catalogMatch, setCatalogMatch] = useState<string | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);

  // Log-based auto-detection
  const { detecting, detected, setDetected } = useDetectModel(selectedContainerId);
  const [pasteLogsOpen, setPasteLogsOpen] = useState(false);

  // Selected container object
  const selectedContainer = useMemo(
    () => containers.find((c) => c.id === selectedContainerId) ?? null,
    [containers, selectedContainerId]
  );

  // Port warnings
  const exposedPorts = useMemo(
    () =>
      selectedContainer
        ? getExposedPorts(selectedContainer.port_bindings)
        : [],
    [selectedContainer]
  );
  const portMismatch = useMemo(() => {
    if (!servicePort || exposedPorts.length === 0) return false;
    return !exposedPorts.includes(parseInt(servicePort, 10));
  }, [servicePort, exposedPorts]);

  // Route hint
  const expectedRoute = DEFAULT_ROUTES[modelType] ?? "/v1/chat/completions";
  const routeMismatch = serviceRoute !== expectedRoute && modelType !== "";

  // Multi-chip board check
  const isMultiSlotBoard = (chipStatus?.total_slots ?? 1) > 1;

  const multiChipConflicts = useMemo(() => {
    if (!chipStatus) return [];
    return chipStatus.slots.filter((s) => s.status === "occupied");
  }, [chipStatus]);

  const loadContainers = useCallback(async () => {
    setLoadingContainers(true);
    try {
      const result = await discoverContainers();
      setContainers(result);
    } catch {
      customToast.error("Failed to discover containers");
      setContainers([]);
    } finally {
      setLoadingContainers(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      const result = await fetchModelCatalog();
      setCatalog(result);
    } catch {
      setCatalog([]);
    }
  }, []);

  const loadChipStatus = useCallback(async () => {
    setLoadingChipStatus(true);
    try {
      const response = await axios.get<ChipStatus>("/docker-api/chip-status/");
      setChipStatus(response.data);
    } catch {
      setChipStatus(null);
    } finally {
      setLoadingChipStatus(false);
    }
  }, []);

  // Load data on mount
  useEffect(() => {
    loadContainers();
    loadCatalog();
    loadChipStatus();
  }, [loadContainers, loadCatalog, loadChipStatus]);

  // Auto-select first available slot when chip status or chipsRequired changes
  useEffect(() => {
    if (!chipStatus) return;
    if (chipsRequired >= 4) {
      setSelectedDeviceId(0);
      return;
    }
    const firstAvailable = chipStatus.slots.find((s) => s.status === "available");
    if (firstAvailable !== undefined) {
      setSelectedDeviceId(firstAvailable.slot_id);
    } else {
      setSelectedDeviceId(null);
    }
  }, [chipStatus, chipsRequired]);

  // When container selection changes, auto-fill port
  useEffect(() => {
    if (selectedContainer) {
      const port = extractFirstPort(selectedContainer.port_bindings);
      if (port) {
        setServicePort(String(port));
      }
    }
  }, [selectedContainer]);

  // When model type changes, auto-update service route
  useEffect(() => {
    if (modelType) {
      setServiceRoute(DEFAULT_ROUTES[modelType] ?? "/v1/chat/completions");
    }
  }, [modelType]);

  // Auto-fill from log detection (only fills empty fields)
  useEffect(() => {
    if (!detected) return;
    if (detected.hf_model_id && !hfModelId) setHfModelId(detected.hf_model_id);
    if (detected.model_type && !modelType) setModelType(detected.model_type);
  }, [detected]); // eslint-disable-line react-hooks/exhaustive-deps

  // HF Model ID catalog matching on blur
  const handleHfModelIdBlur = useCallback(() => {
    if (!hfModelId.trim() || catalog.length === 0) {
      setCatalogMatch(null);
      return;
    }
    const match = catalog.find(
      (m) => m.hf_model_id?.toLowerCase() === hfModelId.trim().toLowerCase()
    );
    if (match) {
      setCatalogMatch(match.model_name);
      const catalogType = match.model_type?.toLowerCase();
      if (catalogType && DEFAULT_ROUTES[catalogType]) {
        setModelType(catalogType);
        setServiceRoute(match.service_route || DEFAULT_ROUTES[catalogType]);
      }
      if (match.health_route) {
        setHealthRoute(match.health_route);
      }
    } else {
      setCatalogMatch(null);
    }
  }, [hfModelId, catalog]);

  // Form validity
  const deviceIdValid =
    chipsRequired >= 4
      ? multiChipConflicts.length === 0
      : selectedDeviceId !== null;

  const canSubmit =
    selectedContainerId !== "" &&
    modelType !== "" &&
    modelName.trim() !== "" &&
    deviceIdValid &&
    !submitting;

  const resetForm = useCallback(() => {
    setSelectedContainerId("");
    setModelType("");
    setModelName("");
    setHfModelId("");
    setServicePort("7000");
    setServiceRoute("/v1/chat/completions");
    setHealthRoute("/health");
    setAdvancedOpen(false);
    setCatalogMatch(null);
    setChipsRequired(1);
    setSelectedDeviceId(null);
    setPasteLogsOpen(false);
  }, []);

  // Submit
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await registerExternalModel({
        container_id: selectedContainerId,
        model_type: modelType,
        model_name: modelName.trim(),
        hf_model_id: hfModelId.trim() || undefined,
        service_port: parseInt(servicePort, 10) || 7000,
        service_route: serviceRoute,
        health_route: healthRoute,
        device_id: chipsRequired >= 4 ? 0 : (selectedDeviceId ?? 0),
        chips_required: chipsRequired,
      });

      if (result.status === "success") {
        const corrections = result.corrections ?? [];
        if (corrections.length > 0) {
          customToast.success(
            `Registered ${result.container_name}. ${corrections.join(". ")}`
          );
        } else {
          customToast.success(
            `Successfully registered ${result.container_name}`
          );
        }
        resetForm();
        onSuccess();
      } else {
        customToast.error(result.message ?? "Registration failed");
      }
    } catch (err: unknown) {
      const anyErr = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      const msg =
        anyErr?.response?.data?.message ??
        anyErr?.message ??
        "Registration failed";
      customToast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    selectedContainerId,
    modelType,
    modelName,
    hfModelId,
    servicePort,
    serviceRoute,
    healthRoute,
    chipsRequired,
    selectedDeviceId,
    onSuccess,
    resetForm,
  ]);

  return (
    <div className="space-y-4 py-2">
      {/* Container selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Container</Label>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={loadContainers}
            disabled={loadingContainers}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loadingContainers ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
        {loadingContainers ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Discovering containers...
          </div>
        ) : containers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            No unregistered containers found. Make sure a container is running
            outside tt_studio_network.
          </p>
        ) : (
          <Select
            value={selectedContainerId}
            onValueChange={setSelectedContainerId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a container..." />
            </SelectTrigger>
            <SelectContent>
              {containers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({c.image?.split("/").pop()?.split(":")[0] ?? c.image})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Detection status */}
        {selectedContainerId && (detecting || detected) && (
          <div className="flex items-center gap-1.5 text-xs mt-0.5">
            {detecting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">
                  Scanning container logs...
                </span>
              </>
            ) : detected && Object.keys(detected).length > 0 ? (
              <>
                <Sparkles className="h-3 w-3 text-blue-400" />
                <span className="text-blue-400">
                  Auto-detected from{" "}
                  {detected.source === "api"
                    ? "vLLM API"
                    : detected.source === "paste"
                    ? "pasted logs"
                    : "container logs"}
                </span>
              </>
            ) : null}
          </div>
        )}

        {/* Paste logs for manual auto-detection */}
        {selectedContainerId && (
          <Collapsible open={pasteLogsOpen} onOpenChange={setPasteLogsOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between text-muted-foreground hover:text-foreground text-xs px-0 h-7"
              >
                Paste server logs to auto-detect model
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    pasteLogsOpen ? "rotate-180" : ""
                  }`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1">
              <textarea
                className="w-full h-28 text-xs font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 text-stone-300 resize-none focus:outline-none focus:ring-1 focus:ring-stone-600 placeholder:text-stone-600"
                placeholder={
                  "Paste output from your terminal here...\n(vLLM startup logs, run.py output, etc.)"
                }
                onChange={(e) => {
                  const parsed = parseVllmLogs(e.target.value);
                  if (Object.keys(parsed).length > 0) {
                    setDetected({ ...parsed, source: "paste" });
                  }
                }}
              />
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      {/* Model Type */}
      <div className="space-y-2">
        <Label>Model Type</Label>
        <Select value={modelType} onValueChange={setModelType}>
          <SelectTrigger>
            <SelectValue placeholder="Select model type..." />
          </SelectTrigger>
          <SelectContent>
            {MODEL_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Model Name */}
      <div className="space-y-2">
        <Label>Model Name</Label>
        <Input
          placeholder="e.g. Llama 3.1 8B Instruct"
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
        />
      </div>

      {/* HuggingFace Model ID */}
      <div className="space-y-2">
        <Label>
          HuggingFace Model ID{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          placeholder="e.g. meta-llama/Llama-3.1-8B-Instruct"
          value={hfModelId}
          onChange={(e) => setHfModelId(e.target.value)}
          onBlur={handleHfModelIdBlur}
        />
        {catalogMatch && (
          <div className="flex items-start gap-2 rounded-md bg-blue-950/40 border border-blue-500/25 px-3 py-2 text-xs text-blue-300">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Matched catalog model: <strong>{catalogMatch}</strong> —
              auto-filled type and routes
            </span>
          </div>
        )}
      </div>

      {/* Device Selection */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Device</Label>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={loadChipStatus}
            disabled={loadingChipStatus}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loadingChipStatus ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        {loadingChipStatus ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading device status...
          </div>
        ) : chipStatus === null ? (
          <p className="text-sm text-muted-foreground py-2">
            Could not load device status. Device 0 will be used.
          </p>
        ) : (
          <>
            {/* Chips Required — only show on multi-slot boards */}
            {isMultiSlotBoard && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setChipsRequired(1)}
                  className={`
                    flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-all duration-150 cursor-pointer text-sm
                    ${
                      chipsRequired === 1
                        ? "border-TT-purple-accent bg-TT-purple-shade/30"
                        : "border-gray-700 bg-[#0d1117] hover:border-TT-purple-accent/50"
                    }
                  `}
                >
                  <Cpu className="h-4 w-4 shrink-0 text-TT-purple-accent" />
                  <div>
                    <div className="font-medium text-white">Single Chip</div>
                    <div className="text-[10px] text-muted-foreground">
                      1 device slot
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setChipsRequired(4)}
                  className={`
                    flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-all duration-150 cursor-pointer text-sm
                    ${
                      chipsRequired >= 4
                        ? "border-TT-purple-accent bg-TT-purple-shade/30"
                        : "border-gray-700 bg-[#0d1117] hover:border-TT-purple-accent/50"
                    }
                  `}
                >
                  <Layers className="h-4 w-4 shrink-0 text-TT-purple-accent" />
                  <div>
                    <div className="font-medium text-white">Multi-Chip</div>
                    <div className="text-[10px] text-muted-foreground">
                      All {chipStatus.total_slots} slots
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* Multi-chip conflict warning */}
            {chipsRequired >= 4 && multiChipConflicts.length > 0 && (
              <div className="flex items-start gap-2 rounded-md bg-amber-950/40 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Multi-chip requires all slots to be free. Currently occupied:{" "}
                  {multiChipConflicts
                    .map(
                      (s) =>
                        `slot ${s.slot_id} (${s.model_name ?? "unknown"})`
                    )
                    .join(", ")}
                  .
                </span>
              </div>
            )}

            {/* Slot picker — single chip on multi-slot board */}
            {chipsRequired === 1 && isMultiSlotBoard && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Select the device slot this model is running on:
                </p>
                <div className="flex flex-wrap gap-2">
                  {chipStatus.slots.map((slot) => {
                    const isOccupied = slot.status === "occupied";
                    const isSelected = selectedDeviceId === slot.slot_id;
                    return (
                      <button
                        key={slot.slot_id}
                        type="button"
                        disabled={isOccupied}
                        onClick={() => setSelectedDeviceId(slot.slot_id)}
                        title={
                          isOccupied
                            ? `Occupied by ${slot.model_name ?? "another model"}`
                            : `Device ${slot.slot_id}`
                        }
                        className={`
                          relative flex flex-col items-center px-3 py-2 rounded-lg border-2 transition-all duration-150 min-w-[72px]
                          ${
                            isOccupied
                              ? "border-gray-700 bg-[#0d1117] opacity-50 cursor-not-allowed"
                              : isSelected
                              ? "border-TT-purple-accent bg-TT-purple-shade/30 shadow-[0_0_12px_rgba(124,104,250,0.3)]"
                              : "border-gray-700 bg-[#0d1117] hover:border-TT-purple-accent/60 cursor-pointer"
                          }
                        `}
                      >
                        <Cpu
                          className={`h-5 w-5 mb-1 ${
                            isOccupied
                              ? "text-gray-600"
                              : isSelected
                              ? "text-TT-purple-accent"
                              : "text-gray-500"
                          }`}
                          strokeWidth={1.4}
                        />
                        <span className="text-[10px] font-mono font-bold text-gray-400">
                          DEVICE {String(slot.slot_id).padStart(2, "0")}
                        </span>
                        <span
                          className={`text-[9px] font-mono mt-0.5 ${
                            isOccupied ? "text-gray-600" : "text-gray-500"
                          }`}
                        >
                          {isOccupied ? "IN USE" : "IDLE"}
                        </span>
                        {isOccupied && slot.model_name && (
                          <span
                            className="text-[8px] text-gray-600 truncate max-w-[64px] mt-0.5"
                            title={slot.model_name}
                          >
                            {slot.model_name}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Single-slot board */}
            {chipsRequired === 1 && !isMultiSlotBoard && (
              <div className="flex items-center gap-2 rounded-md bg-stone-900/60 border border-stone-700 px-3 py-2 text-xs text-muted-foreground">
                <Cpu className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Single-device board — model will be registered on{" "}
                  <strong className="text-foreground">Device 00</strong>.
                </span>
              </div>
            )}

            {/* Multi-chip: all slots summary */}
            {chipsRequired >= 4 && multiChipConflicts.length === 0 && (
              <div className="flex items-center gap-2 rounded-md bg-TT-purple-shade/20 border border-TT-purple-accent/25 px-3 py-2 text-xs text-TT-purple">
                <Layers className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Model will be registered across all {chipStatus.total_slots}{" "}
                  device slots.
                </span>
              </div>
            )}

            {/* No slots available warning */}
            {chipsRequired === 1 &&
              chipStatus.slots.every((s) => s.status === "occupied") && (
                <div className="flex items-start gap-2 rounded-md bg-amber-950/40 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    All device slots are occupied. Stop a running model to free
                    up a slot.
                  </span>
                </div>
              )}
          </>
        )}
      </div>

      {/* Advanced section */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between text-muted-foreground hover:text-foreground"
          >
            Advanced Settings
            <ChevronDown
              className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          {/* Service Port */}
          <div className="space-y-1.5">
            <Label className="text-xs">Service Port</Label>
            <Input
              type="number"
              value={servicePort}
              onChange={(e) => setServicePort(e.target.value)}
            />
            {portMismatch && (
              <div className="flex items-start gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Container does not expose port {servicePort}. Available
                  ports: {exposedPorts.join(", ")}
                </span>
              </div>
            )}
          </div>

          {/* Service Route */}
          <div className="space-y-1.5">
            <Label className="text-xs">Service Route</Label>
            <Input
              value={serviceRoute}
              onChange={(e) => setServiceRoute(e.target.value)}
            />
            {routeMismatch && (
              <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Typical route for{" "}
                  {MODEL_TYPE_OPTIONS.find((o) => o.value === modelType)
                    ?.label ?? modelType}{" "}
                  models is <code className="font-mono">{expectedRoute}</code>
                </span>
              </div>
            )}
          </div>

          {/* Health Route */}
          <div className="space-y-1.5">
            <Label className="text-xs">Health Route</Label>
            <Input
              value={healthRoute}
              onChange={(e) => setHealthRoute(e.target.value)}
            />
            {healthRoute !== "/health" && (
              <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Standard health route is{" "}
                  <code className="font-mono">/health</code>
                </span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Footer buttons */}
      <div className="flex justify-end gap-2 pt-2 border-t border-stone-800">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Registering...
            </>
          ) : (
            "Register"
          )}
        </Button>
      </div>
    </div>
  );
}
