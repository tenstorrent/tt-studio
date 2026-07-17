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
import { Loader2, RefreshCw, Info, AlertTriangle, Cpu, Layers } from "lucide-react";
import { customToast } from "../CustomToaster";
import {
  discoverContainers,
  registerExternalModel,
  fetchModelCatalog,
  type DiscoveredContainer,
  type CatalogModel,
} from "../../api/modelsDeployedApis";
import { useDetectModel } from "../../hooks/useDetectModel";

interface RegisterModelFormProps {
  onSuccess: () => void;
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

export default function RegisterModelForm({ onSuccess }: RegisterModelFormProps) {
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

  // Device selection state
  const [chipsRequired, setChipsRequired] = useState<1 | 4>(1);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);

  // Catalog match banner
  const [catalogMatch, setCatalogMatch] = useState<string | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);

  // Selected container object
  const selectedContainer = useMemo(
    () => containers.find((c) => c.id === selectedContainerId) ?? null,
    [containers, selectedContainerId]
  );

  // Chips auto-detected from the container's bound /dev/tenstorrent nodes. When
  // present these are enforced (the user cannot override); manual selection is
  // only offered as a last resort when detection yields nothing.
  const autoDetectedDeviceIds = useMemo<number[] | null>(
    () =>
      selectedContainer?.device_ids && selectedContainer.device_ids.length > 0
        ? selectedContainer.device_ids
        : null,
    [selectedContainer]
  );

  // Multi-chip board check
  const isMultiSlotBoard = (chipStatus?.total_slots ?? 1) > 1;

  // For multi-chip mode, check whether all slots are free
  const multiChipConflicts = useMemo(() => {
    if (!chipStatus) return [];
    return chipStatus.slots.filter((s) => s.status === "occupied");
  }, [chipStatus]);

  // Load containers
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

  // Load catalog
  const loadCatalog = useCallback(async () => {
    try {
      const result = await fetchModelCatalog();
      setCatalog(result);
    } catch {
      setCatalog([]);
    }
  }, []);

  // Load chip status
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

  // Load discovery data on mount (state already starts at the reset defaults).
  useEffect(() => {
    loadContainers();
    loadCatalog();
    loadChipStatus();
  }, [loadContainers, loadCatalog, loadChipStatus]);

  // HF Model ID catalog matching — surfaces the model name/type for the summary.
  // Routes/port are derived server-side at registration, so we don't set them here.
  const applyCatalogMatch = useCallback((idValue: string) => {
    if (!idValue.trim() || catalog.length === 0) {
      setCatalogMatch(null);
      return;
    }
    const match = catalog.find(
      (m) => m.hf_model_id?.toLowerCase() === idValue.trim().toLowerCase()
    );
    if (match) {
      setCatalogMatch(match.model_name);
      const catalogType = match.model_type?.toLowerCase();
      if (catalogType) setModelType(catalogType);
      // Prefill the model name from the catalog if the user hasn't typed one.
      setModelName((prev) => prev || match.model_name);
    } else {
      setCatalogMatch(null);
    }
  }, [catalog]);

  const handleHfModelIdBlur = useCallback(
    () => applyCatalogMatch(hfModelId),
    [applyCatalogMatch, hfModelId]
  );

  // Switching containers clears the previously-derived identity so a stale
  // model/type can't linger; detection below refills it for the new container.
  useEffect(() => {
    setModelType("");
    setModelName("");
    setHfModelId("");
    setCatalogMatch(null);
  }, [selectedContainerId]);

  // Auto-detect the model served by the selected container and prefill the form.
  const { detecting, detected } = useDetectModel(selectedContainerId);
  useEffect(() => {
    if (!detected) return;
    if (detected.model_type) setModelType(detected.model_type);
    if (detected.hf_model_id) {
      setHfModelId(detected.hf_model_id);
      applyCatalogMatch(detected.hf_model_id);
    }
  }, [detected, applyCatalogMatch]);

  // Only a container is required. The backend derives model name, type, routes,
  // port and devices from the running container (live /v1/models → logs → catalog
  // → bound chip nodes). The form fields are optional overrides / last resort.
  const canSubmit = selectedContainerId !== "" && !submitting;

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
        onSuccess();
      } else {
        customToast.error(result.message ?? "Registration failed");
      }
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { message?: string } }; message?: string };
      const msg =
        anyErr?.response?.data?.message ?? anyErr?.message ?? "Registration failed";
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
    chipsRequired,
    selectedDeviceId,
    onSuccess,
  ]);

  return (
    <div className="space-y-4">
      <div className="space-y-4">
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
          </div>

          {/* Model identity — derived from the container. Name is always derived
              server-side (never asked). Type is derived too; we only ask for it
              (and the HF id) as a last resort when the model can't be identified. */}
          {selectedContainerId && (
            detecting ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                <Loader2 className="h-4 w-4 animate-spin" />
                Identifying model…
              </div>
            ) : modelType ? (
              <div className="flex items-start gap-2 rounded-md bg-blue-950/40 border border-blue-500/25 px-3 py-2 text-xs text-blue-300">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Detected model:{" "}
                  <strong className="text-foreground">
                    {catalogMatch || hfModelId || modelName || "custom model"}
                  </strong>{" "}
                  · type{" "}
                  <strong className="text-foreground">
                    {MODEL_TYPE_OPTIONS.find((o) => o.value === modelType)?.label ?? modelType}
                  </strong>
                </span>
              </div>
            ) : (
              <div className="space-y-3 rounded-md border border-stone-700 bg-stone-900/40 px-3 py-3">
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    Add the model's HuggingFace ID to auto-fill everything, or just
                    pick its type.
                  </span>
                </div>
                <div className="space-y-2">
                  <Label>HuggingFace Model ID</Label>
                  <Input
                    placeholder="e.g. meta-llama/Llama-3.1-8B-Instruct"
                    value={hfModelId}
                    onChange={(e) => setHfModelId(e.target.value)}
                    onBlur={handleHfModelIdBlur}
                  />
                </div>
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
              </div>
            )
          )}

          {/* ── Device Selection ── */}
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

            {autoDetectedDeviceIds ? (
              <div className="flex items-start gap-2 rounded-md bg-TT-purple-shade/20 border border-TT-purple-accent/25 px-3 py-2 text-xs text-TT-purple">
                <Cpu className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Auto-detected from the container:{" "}
                  <strong className="text-foreground">
                    {autoDetectedDeviceIds
                      .map((d) => `Device ${String(d).padStart(2, "0")}`)
                      .join(", ")}
                  </strong>
                  . These are fixed by the running container and can't be changed.
                </span>
              </div>
            ) : loadingChipStatus ? (
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
                    {/* Single Chip card */}
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
                        <div className="font-medium text-white">Single Device</div>
                        <div className="text-[10px] text-muted-foreground">1 device slot</div>
                      </div>
                    </button>

                    {/* Multi Chip card */}
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
                        <div className="font-medium text-white">Multi-Device</div>
                        <div className="text-[10px] text-muted-foreground">All {chipStatus.total_slots} slots</div>
                      </div>
                    </button>
                  </div>
                )}

                {/* Multi-chip conflict warning */}
                {chipsRequired >= 4 && multiChipConflicts.length > 0 && (
                  <div className="flex items-start gap-2 rounded-md bg-amber-950/40 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Multi-device requires all slots to be free. Currently occupied:{" "}
                      {multiChipConflicts
                        .map((s) => `slot ${s.slot_id} (${s.model_name ?? "unknown"})`)
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

                {/* Single-slot board — just show the single device */}
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
                      Model will be registered across all {chipStatus.total_slots} device slots.
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

        </div>

      <div className="flex justify-end pt-2">
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
