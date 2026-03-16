// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../ui/dialog";
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
import { Loader2, RefreshCw, ChevronDown, Info, AlertTriangle } from "lucide-react";
import { customToast } from "../CustomToaster";
import {
  discoverContainers,
  registerExternalModel,
  fetchModelCatalog,
  type DiscoveredContainer,
  type CatalogModel,
} from "../../api/modelsDeployedApis";

interface RegisterModelDialogProps {
  open: boolean;
  onClose: () => void;
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

/** Extract the first exposed container port from port_bindings */
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

/** Get all exposed ports from port_bindings */
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

export default function RegisterModelDialog({
  open,
  onClose,
  onSuccess,
}: RegisterModelDialogProps) {
  // Container discovery
  const [containers, setContainers] = useState<DiscoveredContainer[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);

  // Catalog for HF model ID matching
  const [catalog, setCatalog] = useState<CatalogModel[]>([]);

  // Form state
  const [selectedContainerId, setSelectedContainerId] = useState("");
  const [modelType, setModelType] = useState("");
  const [modelName, setModelName] = useState("");
  const [hfModelId, setHfModelId] = useState("");
  const [servicePort, setServicePort] = useState("7000");
  const [serviceRoute, setServiceRoute] = useState("/v1/chat/completions");
  const [healthRoute, setHealthRoute] = useState("/health");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Catalog match banner
  const [catalogMatch, setCatalogMatch] = useState<string | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);

  // Selected container object
  const selectedContainer = useMemo(
    () => containers.find((c) => c.id === selectedContainerId) ?? null,
    [containers, selectedContainerId]
  );

  // Port warnings
  const exposedPorts = useMemo(
    () => (selectedContainer ? getExposedPorts(selectedContainer.port_bindings) : []),
    [selectedContainer]
  );
  const portMismatch = useMemo(() => {
    if (!servicePort || exposedPorts.length === 0) return false;
    return !exposedPorts.includes(parseInt(servicePort, 10));
  }, [servicePort, exposedPorts]);

  // Route hint
  const expectedRoute = DEFAULT_ROUTES[modelType] ?? "/v1/chat/completions";
  const routeMismatch = serviceRoute !== expectedRoute && modelType !== "";

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

  // Load on open
  useEffect(() => {
    if (open) {
      loadContainers();
      loadCatalog();
      // Reset form
      setSelectedContainerId("");
      setModelType("");
      setModelName("");
      setHfModelId("");
      setServicePort("7000");
      setServiceRoute("/v1/chat/completions");
      setHealthRoute("/health");
      setAdvancedOpen(false);
      setCatalogMatch(null);
    }
  }, [open, loadContainers, loadCatalog]);

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
      // Auto-fill from catalog
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
  const canSubmit =
    selectedContainerId !== "" &&
    modelType !== "" &&
    modelName.trim() !== "" &&
    !submitting;

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
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ?? err?.message ?? "Registration failed";
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
    onSuccess,
  ]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg dark:bg-stone-950 dark:border-stone-800">
        <DialogHeader>
          <DialogTitle>Register External Model</DialogTitle>
          <DialogDescription>
            Connect a running Docker container to TT Studio
          </DialogDescription>
        </DialogHeader>

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
                  Matched catalog model: <strong>{catalogMatch}</strong> — auto-filled
                  type and routes
                </span>
              </div>
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
                      {MODEL_TYPE_OPTIONS.find((o) => o.value === modelType)?.label ??
                        modelType}{" "}
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
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
