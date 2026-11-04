// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Button } from "@tenstorrent/vesper/button";
import { Spinner } from "@tenstorrent/vesper/icons";
import { Select } from "@tenstorrent/vesper/select";
import { Snippet } from "@tenstorrent/vesper/snippet";
import { Tag } from "@tenstorrent/vesper/tag";
import { addToast } from "@tenstorrent/vesper/toast";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { Typography } from "@tenstorrent/vesper/typography";
import { getSettings, runHfCheck } from "@/src/api/settingsApi";
import { fetchMergedCheckpoints } from "@/src/api/trainingApi";
import { useIsResetting } from "@/src/hooks/useIsResetting";
import { useModels } from "@/src/hooks/useModels";
import { isHfBlocked, statusLabel } from "@/src/lib/hfStatus";
import { SETTINGS_PATH } from "@/src/routes/route-config";
import type { ChipStatus } from "@/src/types/chipStatus";
import {
  autoPlacementFor,
  cardGroupFor,
  deployabilityReason,
  fullBoardSlots,
  minDevicesFor,
  placementFor,
  profileForDevices,
  type ModelPlacement,
} from "@/src/utils/deviceFit";
import { DeviceChip } from "@/src/vesper/components/device-tag";
import { ModelLogo } from "@/src/vesper/components/model-logo";
import { useChipStatus } from "@/src/vesper/hooks/use-chip-status";
import type { CatalogModel } from "@/src/vesper/types";
import { getModelTask } from "@/src/vesper/utils/models";
import { describeDeployError, useDeployModel } from "../hooks/use-deploy-model";
import {
  buildAutoDeployRequest,
  getModelTags,
  LARGE_WEIGHTS_MODELS,
} from "../utils";

type Tier = "single" | "pair" | "card" | "board";

interface TierOption {
  tier: Tier;
  label: string;
  /** Device groups a deployment of this tier can be placed on */
  groups: number[][];
}

const BASE_MODEL = "__base_model__";

/** The device configurations a model can be deployed in on this board. */
function getTierOptions(
  placement: ModelPlacement,
  totalSlots: number
): TierOption[] {
  const board = fullBoardSlots(totalSlots);
  const devices = (n: number) => `${n} ${n === 1 ? "device" : "devices"}`;
  const options: TierOption[] = [];
  if (placement.allowsSingle) {
    options.push({
      tier: "single",
      label: "Single device",
      groups: Array.from({ length: totalSlots }, (_, i) => [i]),
    });
  }
  if (placement.pairGroups?.length) {
    options.push({
      tier: "pair",
      label: `One card (${devices(placement.pairGroups[0].length)})`,
      groups: placement.pairGroups,
    });
  }
  if (placement.cardGroups.length > 0) {
    options.push({
      tier: "card",
      label: `One card (${devices(placement.cardGroups[0].length)})`,
      groups: placement.cardGroups,
    });
  }
  if (placement.allowsFullBoard || placement.defaultsFullBoard) {
    options.push({
      tier: "board",
      label: `Full board (${devices(board.length)})`,
      groups: [board],
    });
  }
  return options;
}

function tierForDevices(
  options: TierOption[],
  deviceIds: number[],
  fullBoard: boolean
): Tier | undefined {
  if (fullBoard && options.some((o) => o.tier === "board")) return "board";
  return options.find((o) => o.groups[0]?.length === deviceIds.length)?.tier;
}

function isFree(chipStatus: ChipStatus | null, slot: number) {
  return (
    chipStatus?.slots.find((s) => s.slot_id === slot)?.status === "available"
  );
}

export function DeployModel({ model }: { model: CatalogModel }) {
  const navigate = useNavigate();
  const { chipStatus } = useChipStatus();
  const isResetting = useIsResetting();
  const { controlPlaneDegraded } = useModels();
  const deploy = useDeployModel();

  const totalSlots = chipStatus?.total_slots ?? 4;
  const placement = useMemo(
    () => placementFor(model, chipStatus?.board_type, totalSlots),
    [model, chipStatus?.board_type, totalSlots]
  );
  const options = useMemo(
    () => getTierOptions(placement, totalSlots),
    [placement, totalSlots]
  );
  const auto = useMemo(
    () =>
      chipStatus
        ? autoPlacementFor(model, placement, chipStatus.slots, totalSlots)
        : null,
    [model, placement, chipStatus, totalSlots]
  );

  // the configuration the user picked; until they do, follow auto placement
  const [manual, setManual] = useState<{
    tier: Tier;
    deviceIds: number[];
  } | null>(null);
  const tier =
    manual?.tier ??
    (auto
      ? tierForDevices(options, auto.deviceIds, auto.fullBoard)
      : undefined) ??
    options[0]?.tier;
  const selectedDevices = manual?.deviceIds ?? auto?.deviceIds ?? [];
  const tierOption = options.find((o) => o.tier === tier);

  // drop a manual pick once one of its devices gets taken
  useEffect(() => {
    if (manual && !manual.deviceIds.every((id) => isFree(chipStatus, id))) {
      setManual((prev) => (prev ? { ...prev, deviceIds: [] } : prev));
    }
  }, [chipStatus, manual]);

  const selectTier = (next: Tier) => {
    const option = options.find((o) => o.tier === next);
    const group = option?.groups.find((g) =>
      g.every((id) => isFree(chipStatus, id))
    );
    setManual({ tier: next, deviceIds: group ?? [] });
  };

  const pickDevice = (deviceId: number) => {
    if (!tierOption || tier === "board") return;
    const group =
      tier === "single"
        ? [deviceId]
        : cardGroupFor(deviceId, tierOption.groups);
    if (!group.every((id) => isFree(chipStatus, id))) return;
    setManual({ tier: tier!, deviceIds: group });
  };

  // Hugging Face access to the model's weights
  const hfRepo = model.hf_model_id ?? null;
  const hfCheck = useQuery({
    queryKey: ["hf-check", hfRepo],
    queryFn: () => runHfCheck(undefined, [hfRepo!]),
    enabled: !!hfRepo,
    staleTime: 60_000,
  });
  const hfResult = hfCheck.data?.results?.[0];
  const hfGate = isHfBlocked(hfResult) ? hfResult : undefined;
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const hfTokenMissing = settings.data ? !settings.data.hf_token.set : false;

  // fine-tuned weights promoted from training jobs
  const checkpoints = useQuery({
    queryKey: ["merged-checkpoints", model.id],
    queryFn: () => fetchMergedCheckpoints(model.id),
    select: (data) => data.filter((c) => c.valid),
  });
  const [checkpoint, setCheckpoint] = useState(BASE_MODEL);

  const requiredDevices =
    tierOption?.groups[0]?.length ?? minDevicesFor(model, totalSlots);
  const blockedReason = !chipStatus
    ? null
    : selectedDevices.length === 0 || !auto
      ? (deployabilityReason(
          placement,
          minDevicesFor(model, totalSlots),
          chipStatus.slots,
          totalSlots
        ) ?? "Pick a free device to deploy on")
      : null;

  const deployDisabled =
    deploy.isPending ||
    isResetting ||
    controlPlaneDegraded ||
    !!hfGate ||
    (!!chipStatus && selectedDevices.length === 0);

  const handleDeploy = () => {
    let request = buildAutoDeployRequest(model, chipStatus);
    if (manual) {
      // the user picked the devices themselves
      const isFlexible = placement.cardGroups.length > 0;
      const fullBoardOptIn =
        placement.allowsSingle && placement.allowsFullBoard;
      const sorted = [...selectedDevices].sort((a, b) => a - b);
      const profile = sorted.length
        ? profileForDevices(model, sorted.length, totalSlots)
        : undefined;
      request = {
        modelId: model.id,
        modelName: model.name,
        deployModelId: profile?.id,
        forceFullBoard: tier === "board" && (isFlexible || fullBoardOptIn),
        deviceId:
          tier === "board" || sorted.length === 0
            ? undefined
            : sorted.length === 1
              ? sorted[0]
              : sorted.join(","),
        deviceIds: sorted,
      };
    }

    deploy.mutate(
      {
        ...request,
        hostWeightsDir: checkpoint !== BASE_MODEL ? checkpoint : undefined,
      },
      {
        onSuccess: (result) => {
          addToast({
            variant: "success",
            content: `Deploying ${model.name}`,
            timeout: 4000,
          });
          navigate(`?deployment=${encodeURIComponent(result.jobId)}`);
        },
        onError: (err) => {
          addToast({ variant: "danger", content: describeDeployError(err) });
        },
      }
    );
  };

  let buttonText = "Deploy model";
  if (deploy.isPending) buttonText = "Starting deployment";
  else if (isResetting) buttonText = "Board resetting";
  else if (hfGate) buttonText = "Hugging Face access needed";
  else if (chipStatus && selectedDevices.length === 0)
    buttonText = auto ? "Select a device" : "Not enough free devices";

  const largeWeightsRepo = LARGE_WEIGHTS_MODELS[model.name];

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-vesper-6 py-vesper-10">
      <div className="flex flex-col gap-vesper-3">
        <div className="flex flex-wrap gap-vesper-2">
          <Tag size="sm" variant="accent-subtle">
            {getModelTask(model)}
          </Tag>
          {getModelTags(model).map((tag) => (
            <Tooltip key={tag.label} content={tag.tooltip} maxWidth={280}>
              <Tag size="sm" variant={tag.variant}>
                {tag.label}
              </Tag>
            </Tooltip>
          ))}
        </div>
        <div className="flex items-center gap-vesper-3">
          <ModelLogo
            hfModelId={model.hf_model_id}
            modelName={model.name}
            className="w-7 h-7"
          />
          <Typography
            as="h2"
            variant="heading-sm"
            className="text-vesper-text-primary break-all"
          >
            {model.name}
          </Typography>
        </div>
      </div>

      {model.no_page_reason && (
        <Admonition variant="info" size="sm" subtle>
          {model.no_page_reason} You can still deploy it and use it through its
          API.
        </Admonition>
      )}
      {isResetting && (
        <Admonition variant="info" size="sm">
          Deployment is paused while the board resets. Try again once it
          finishes, in about a minute or two.
        </Admonition>
      )}
      {controlPlaneDegraded && (
        <Admonition variant="warning" size="sm" subtle>
          The Docker control service is unreachable, so deploying is paused.
          Deployed models keep working.
        </Admonition>
      )}
      {hfGate && (
        <Admonition
          variant="danger"
          size="sm"
          subtle
          ctaAs="a"
          cta={{
            children: "Request access",
            href: hfGate.url,
            target: "_blank",
            rel: "noreferrer",
          }}
        >
          {model.name} is gated on Hugging Face (
          {statusLabel(hfGate).toLowerCase()}). Accept the model's licence with
          the account your token belongs to, then re-check.{" "}
          <button
            type="button"
            className="underline text-vesper-text-link-default"
            onClick={() => void hfCheck.refetch()}
          >
            Re-check access
          </button>
        </Admonition>
      )}
      {hfTokenMissing && !hfGate && (
        <Admonition
          variant="warning"
          size="sm"
          subtle
          ctaAs="button"
          cta={{ children: "Settings", onClick: () => navigate(SETTINGS_PATH) }}
        >
          No Hugging Face token is set. Deploys of gated models (Llama, Gemma,
          …) will stall at 0% without one.
        </Admonition>
      )}
      {largeWeightsRepo && (
        <Admonition variant="warning" size="sm" subtle>
          <div className="flex flex-col gap-vesper-2">
            <span>
              Hugging Face often stalls downloading these large weights
              mid-deploy. Pre-fetch them first, then deploy:
            </span>
            <Snippet>{`hf download ${largeWeightsRepo}`}</Snippet>
          </div>
        </Admonition>
      )}

      <div className="flex flex-col gap-vesper-6 p-vesper-4 rounded-vesper-2 border border-vesper-border-secondary bg-vesper-background-primary">
        <div className="flex flex-col gap-vesper-1">
          <Typography
            as="h3"
            variant="heading-xs"
            className="text-vesper-text-primary"
          >
            Device Configuration
          </Typography>
          <Typography variant="copy-xs" className="text-vesper-text-secondary">
            Assigned automatically. Can be changed manually by selecting an
            available device.
          </Typography>
        </div>
        {options.length > 1 && (
          <label className="flex flex-col gap-vesper-2">
            <Typography
              as="span"
              variant="label-sm"
              className="text-vesper-text-primary"
            >
              Choose a configuration
            </Typography>
            <Select
              aria-label="Device configuration"
              options={options.map((o) => ({ value: o.tier, label: o.label }))}
              value={tier ?? null}
              onValueChange={(value) => value && selectTier(value as Tier)}
            />
          </label>
        )}
        <div className="flex flex-col gap-vesper-4 p-vesper-4 rounded-vesper-1 bg-vesper-tint-neutral-100">
          <Typography
            variant="label-sm-bold"
            className="text-vesper-text-primary"
          >
            Devices required: {requiredDevices}
          </Typography>
          {chipStatus ? (
            <div className="flex flex-wrap gap-vesper-3">
              {chipStatus.slots.map((slot) => (
                <DeviceChip
                  key={slot.slot_id}
                  deviceId={slot.slot_id}
                  selected={selectedDevices.includes(slot.slot_id)}
                  disabled={slot.status !== "available" || tier === "board"}
                  onSelect={() => pickDevice(slot.slot_id)}
                />
              ))}
            </div>
          ) : (
            <Typography variant="copy-xs" className="text-vesper-text-tertiary">
              Reading device status…
            </Typography>
          )}
          {blockedReason && (
            <Typography variant="copy-xs" className="text-vesper-text-warning">
              {blockedReason}
            </Typography>
          )}
        </div>
        {checkpoints.data && checkpoints.data.length > 0 && (
          <label className="flex flex-col gap-vesper-2">
            <Typography
              as="span"
              variant="label-sm"
              className="text-vesper-text-primary"
            >
              Fine-tuned weights
            </Typography>
            <Select
              aria-label="Fine-tuned weights"
              options={[
                { value: BASE_MODEL, label: "Base model (no adapter)" },
                ...checkpoints.data.map((c) => ({
                  value: c.path,
                  label: `${c.checkpoint_id || c.merge_id}${
                    c.source_job_id
                      ? ` · job ${c.source_job_id.slice(0, 6)}`
                      : ""
                  }`,
                })),
              ]}
              value={checkpoint}
              onValueChange={(value) => setCheckpoint(value ?? BASE_MODEL)}
            />
          </label>
        )}
      </div>

      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={deployDisabled}
        iconLeft={deploy.isPending && <Spinner className="animate-spin" />}
        onClick={handleDeploy}
      >
        {buttonText}
      </Button>
    </div>
  );
}
