// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Box, Check, Loader2, Minus, RefreshCw } from "lucide-react";
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

// What is sent for one container. All optional: the backend derives the model's
// identity, routes, port and devices from the running container, so these only
// carry what detection found or the user typed as a last resort.
interface Identity {
  modelType: string;
  modelName: string;
  hfModelId: string;
  catalogMatch: string | null;
}

const EMPTY_IDENTITY: Identity = {
  modelType: "",
  modelName: "",
  hfModelId: "",
  catalogMatch: null,
};

// The catalog entry an HF model id names: its display name and model type.
function matchCatalog(catalog: CatalogModel[], hfModelId: string): Partial<Identity> {
  const id = hfModelId.trim().toLowerCase();
  const match = id ? catalog.find((m) => m.hf_model_id?.toLowerCase() === id) : undefined;
  if (!match) return { catalogMatch: null };
  return {
    catalogMatch: match.model_name,
    modelName: match.model_name,
    ...(match.model_type ? { modelType: match.model_type.toLowerCase() } : {}),
  };
}

function typeLabel(modelType: string): string {
  return MODEL_TYPE_OPTIONS.find((o) => o.value === modelType)?.label ?? modelType;
}

// Selection indicator in the app's purple, standing in for a native checkbox.
function SelectionMark({ state }: { state: "on" | "off" | "some" }) {
  const Icon = state === "on" ? Check : state === "some" ? Minus : null;
  return (
    <span
      aria-hidden="true"
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors ${
        state === "off"
          ? "border-stone-400 bg-white/60 group-hover:border-TT-purple/70 dark:border-stone-600 dark:bg-stone-900/60"
          : "border-TT-purple-accent bg-TT-purple-accent text-white"
      }`}
    >
      {Icon && <Icon className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

const PILL = "rounded-full px-2 py-0.5 text-[10px] font-medium";

function ContainerRow({
  container,
  catalog,
  selected,
  onToggle,
  identity,
  onIdentity,
}: {
  container: DiscoveredContainer;
  catalog: CatalogModel[];
  selected: boolean;
  onToggle: () => void;
  identity: Identity;
  onIdentity: (patch: Partial<Identity>) => void;
}) {
  const { detecting, detected } = useDetectModel(container.id);
  useEffect(() => {
    if (!detected) return;
    onIdentity({
      ...(detected.model_type ? { modelType: detected.model_type } : {}),
      ...(detected.hf_model_id
        ? { hfModelId: detected.hf_model_id, ...matchCatalog(catalog, detected.hf_model_id) }
        : {}),
    });
    // onIdentity is rebuilt every render; only a new detection should apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detected, catalog]);

  const image = container.image?.split("/").pop()?.split(":")[0] ?? container.image;
  const devices = container.device_ids?.length ? container.device_ids : null;
  const identified = !!identity.modelType;

  return (
    <div
      className={`rounded-xl border-[2px] text-left transition-all duration-200 ${
        selected
          ? "border-TT-purple/70 bg-TT-purple/5 shadow-[0_0_20px_rgba(124,104,250,0.18)] dark:bg-TT-purple/10"
          : "border-stone-200 bg-white/60 hover:border-TT-purple/40 dark:border-stone-700 dark:bg-stone-900/60 dark:hover:border-TT-purple/40"
      }`}
    >
      <div
        role="checkbox"
        aria-checked={selected}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="group flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-TT-purple-accent/60"
      >
        <div
          className={`rounded-lg p-2 transition-colors ${
            selected
              ? "bg-TT-purple/20 text-TT-purple"
              : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
          }`}
        >
          <Box className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{container.name}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">{image}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {detecting ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Identifying model…
              </span>
            ) : identified ? (
              <>
                <span className="truncate text-foreground">
                  {identity.catalogMatch || identity.hfModelId || identity.modelName || "custom model"}
                </span>
                <span className={`${PILL} bg-TT-purple/10 text-TT-purple dark:bg-TT-purple/20`}>
                  {typeLabel(identity.modelType)}
                </span>
              </>
            ) : (
              <span>Model not identified</span>
            )}
            {devices && (
              <span className={`${PILL} bg-stone-100 font-mono text-stone-600 dark:bg-stone-800 dark:text-stone-300`}>
                {devices.length === 1 ? "Device" : "Devices"} {devices.join(", ")}
              </span>
            )}
          </div>
        </div>
        <SelectionMark state={selected ? "on" : "off"} />
      </div>

      {/* Last resort for a model detection could not name. Both stay optional: left
          blank, the container registers for status, logs and delete only. */}
      {selected && !detecting && !identified && (
        <div className="grid gap-2 border-t border-TT-purple/20 px-4 pb-3 pt-3 sm:grid-cols-2">
          <Input
            placeholder="HuggingFace ID, e.g. meta-llama/Llama-3.1-8B-Instruct"
            value={identity.hfModelId}
            onChange={(e) => onIdentity({ hfModelId: e.target.value })}
            onBlur={() => onIdentity(matchCatalog(catalog, identity.hfModelId))}
          />
          <Select
            value={identity.modelType}
            onValueChange={(v) => onIdentity({ modelType: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Model type" />
            </SelectTrigger>
            <SelectContent>
              {MODEL_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="sm:col-span-2 text-[11px] text-muted-foreground">
            Optional. Left blank, it registers for status, logs and delete only, with no
            chat or TTS page.
          </p>
        </div>
      )}
    </div>
  );
}

export default function RegisterModelForm({ onSuccess }: RegisterModelFormProps) {
  const [containers, setContainers] = useState<DiscoveredContainer[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  // Catalog for HF model ID matching
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [identities, setIdentities] = useState<Record<string, Identity>>({});
  const [submitting, setSubmitting] = useState(false);

  const loadContainers = useCallback(async () => {
    setLoadingContainers(true);
    try {
      const result = await discoverContainers();
      setContainers(result);
      // Keep only selections whose container is still listed.
      setSelected((prev) => new Set(result.map((c) => c.id).filter((id) => prev.has(id))));
    } catch {
      customToast.error("Failed to discover containers");
      setContainers([]);
    } finally {
      setLoadingContainers(false);
    }
  }, []);

  useEffect(() => {
    loadContainers();
    fetchModelCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [loadContainers]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = containers.length > 0 && selected.size === containers.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(containers.map((c) => c.id)));

  const setIdentity = (id: string, patch: Partial<Identity>) =>
    setIdentities((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? EMPTY_IDENTITY), ...patch },
    }));

  const canSubmit = selected.size > 0 && !submitting;

  // One request per container, in turn: each registration writes the shared
  // deployment store and connects its container to tt_studio_network.
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    let failed = 0;
    try {
      for (const container of containers.filter((c) => selected.has(c.id))) {
        const identity = identities[container.id] ?? EMPTY_IDENTITY;
        try {
          const result = await registerExternalModel({
            container_id: container.id,
            model_type: identity.modelType,
            model_name: identity.modelName.trim(),
            hf_model_id: identity.hfModelId.trim() || undefined,
          });
          if (result.status === "success") {
            const corrections = result.corrections ?? [];
            customToast.success(
              corrections.length > 0
                ? `Registered ${result.container_name}. ${corrections.join(". ")}`
                : `Registered ${result.container_name}`
            );
          } else {
            failed += 1;
            customToast.error(`${container.name}: ${result.message ?? "Registration failed"}`);
          }
        } catch (err: unknown) {
          failed += 1;
          const anyErr = err as { response?: { data?: { message?: string } }; message?: string };
          const msg = anyErr?.response?.data?.message ?? anyErr?.message ?? "Registration failed";
          customToast.error(`${container.name}: ${msg}`);
        }
      }
    } finally {
      setSubmitting(false);
    }
    // On any failure stay here, with the registered rows gone, so the rest can be retried.
    if (failed === 0) onSuccess();
    else loadContainers();
  }, [canSubmit, containers, selected, identities, onSuccess, loadContainers]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">Containers</span>
          {containers.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {selected.size} of {containers.length} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {containers.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="group flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-stone-100 hover:text-foreground dark:hover:bg-stone-800"
            >
              <SelectionMark
                state={allSelected ? "on" : selected.size > 0 ? "some" : "off"}
              />
              Select all
            </button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={loadContainers}
            disabled={loadingContainers}
            aria-label="Refresh containers"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingContainers ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loadingContainers && containers.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Discovering containers...
        </div>
      ) : containers.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No unregistered model containers found. Make sure the model's container is
          running with its Tenstorrent devices.
        </p>
      ) : (
        <div className="space-y-2">
          {containers.map((c) => (
            <ContainerRow
              key={c.id}
              container={c}
              catalog={catalog}
              selected={selected.has(c.id)}
              onToggle={() => toggle(c.id)}
              identity={identities[c.id] ?? EMPTY_IDENTITY}
              onIdentity={(patch) => setIdentity(c.id, patch)}
            />
          ))}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Registering...
            </>
          ) : selected.size > 1 ? (
            `Register ${selected.size}`
          ) : (
            "Register"
          )}
        </Button>
      </div>
    </div>
  );
}
