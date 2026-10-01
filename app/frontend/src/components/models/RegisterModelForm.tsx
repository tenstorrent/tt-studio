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
import { Loader2, RefreshCw } from "lucide-react";
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
      className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-TT-purple-accent/60 bg-TT-purple-shade/15"
          : "border-stone-700 hover:border-stone-500"
      }`}
    >
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="accent-TT-purple mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-sm text-foreground truncate">
              {container.name}
            </span>
            <span className="text-xs text-muted-foreground truncate">{image}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {detecting ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Identifying model…
              </span>
            ) : identified ? (
              <>
                <span className="text-foreground">
                  {identity.catalogMatch || identity.hfModelId || identity.modelName || "custom model"}
                </span>
                {" · "}
                {typeLabel(identity.modelType)}
              </>
            ) : (
              "Model not identified"
            )}
            {devices && (
              <>
                {" · "}
                {devices.length === 1 ? "device" : "devices"} {devices.join(", ")}
              </>
            )}
          </div>
        </div>
      </label>

      {/* Last resort for a model detection could not name. Both stay optional: left
          blank, the container registers for status, logs and delete only. */}
      {selected && !detecting && !identified && (
        <div className="mt-2.5 ml-7 grid gap-2 sm:grid-cols-2">
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
        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          {containers.length > 0 && (
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="accent-TT-purple"
            />
          )}
          Containers
          {containers.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {selected.size} of {containers.length} selected
            </span>
          )}
        </label>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={loadContainers}
          disabled={loadingContainers}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingContainers ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loadingContainers && containers.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Discovering containers...
        </div>
      ) : containers.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No unregistered containers found. Make sure a container is running outside
          tt_studio_network.
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
