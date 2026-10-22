// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Button } from "@tenstorrent/vesper/button";
import { AIAgent, Spinner } from "@tenstorrent/vesper/icons";
import { Select } from "@tenstorrent/vesper/select";
import { Tag } from "@tenstorrent/vesper/tag";
import { addToast } from "@tenstorrent/vesper/toast";
import { Typography } from "@tenstorrent/vesper/typography";
import { runHfCheck } from "@/src/api/settingsApi";
import { useIsResetting } from "@/src/hooks/useIsResetting";
import { isHfBlocked } from "@/src/lib/hfStatus";
import { DeviceChip } from "@/src/vesper/components/device-tag";
import { useChipStatus } from "@/src/vesper/hooks/use-chip-status";
import { useModelCatalog } from "@/src/vesper/hooks/use-model-catalog";
import { formatDeviceLabel } from "@/src/vesper/utils/models";
import { describeDeployError, useDeployModel } from "../hooks/use-deploy-model";
import { SOLUTION_KEY_PREFIX, type SolutionGroup } from "../solution-groups";
import {
  getDefaultStageModels,
  getStageModels,
  planVoiceAgent,
  STAGE_LABEL,
  type VoiceAgentStage,
} from "../solutions";

const STAGES: VoiceAgentStage[] = ["llm", "stt", "tts"];
// media models go first: they share an image and start in seconds, while the
// LLM's long weights download would otherwise hold them behind it
const DEPLOY_ORDER: VoiceAgentStage[] = ["stt", "tts", "llm"];

export function DeploySolution({
  onGroupCreated,
}: {
  onGroupCreated(group: SolutionGroup): void;
}) {
  const navigate = useNavigate();
  const catalog = useModelCatalog();
  const { chipStatus } = useChipStatus();
  const isResetting = useIsResetting();
  const deploy = useDeployModel();
  const [deploying, setDeploying] = useState(false);

  const totalSlots = chipStatus?.total_slots ?? 4;
  const stageModels = useMemo(
    () => getStageModels(catalog.data ?? [], totalSlots),
    [catalog.data, totalSlots]
  );
  const [selected, setSelected] = useState<Record<VoiceAgentStage, string>>({
    llm: "",
    stt: "",
    tts: "",
  });
  // default picks once the catalog is in
  useEffect(() => {
    const defaults = getDefaultStageModels(stageModels);
    setSelected((prev) => ({
      llm: prev.llm || defaults.llm,
      stt: prev.stt || defaults.stt,
      tts: prev.tts || defaults.tts,
    }));
  }, [stageModels]);

  const models = {
    llm: stageModels.llm.find((m) => m.id === selected.llm),
    stt: stageModels.stt.find((m) => m.id === selected.stt),
    tts: stageModels.tts.find((m) => m.id === selected.tts),
  };
  const plan = planVoiceAgent(models, totalSlots);
  const targetSlots = STAGES.flatMap((stage) => plan.slots[stage]);
  const insufficient = !!chipStatus && totalSlots < plan.requiredSlots;
  const conflicts = (chipStatus?.slots ?? []).filter(
    (s) => targetSlots.includes(s.slot_id) && s.status === "occupied"
  );

  const llmRepo = models.llm?.hf_model_id ?? null;
  const hfCheck = useQuery({
    queryKey: ["hf-check", llmRepo],
    queryFn: () => runHfCheck(undefined, [llmRepo!]),
    enabled: !!llmRepo,
    staleTime: 60_000,
  });
  const hfGate = isHfBlocked(hfCheck.data?.results?.[0])
    ? hfCheck.data?.results?.[0]
    : undefined;

  const canDeploy =
    !deploying &&
    !isResetting &&
    !insufficient &&
    conflicts.length === 0 &&
    !hfGate &&
    !!models.llm &&
    !!models.stt &&
    !!models.tts;

  const handleDeploy = async () => {
    setDeploying(true);
    const members: SolutionGroup["members"] = [];
    const failures: string[] = [];
    for (const stage of DEPLOY_ORDER) {
      const model = models[stage]!;
      const slots = plan.slots[stage];
      try {
        const result = await deploy.mutateAsync({
          modelId: model.id,
          modelName: model.name,
          deployModelId: plan.deployIds[stage],
          deviceId: slots.length === 1 ? slots[0] : slots.join(","),
          deviceIds: slots,
        });
        members.push({
          modelId: model.id,
          modelName: model.name,
          jobId: result.jobId,
        });
      } catch (err) {
        failures.push(`${STAGE_LABEL[stage]}: ${describeDeployError(err)}`);
      }
    }
    setDeploying(false);

    if (failures.length > 0) {
      addToast({
        variant: "danger",
        content: `Deployed ${members.length} of ${DEPLOY_ORDER.length} models. ${failures.join(" ")}`,
      });
    }
    if (members.length > 0) {
      const group: SolutionGroup = {
        id: uuidv4(),
        name: "Voice Agent",
        createdAt: Date.now(),
        members,
      };
      onGroupCreated(group);
      navigate(
        `?deployment=${encodeURIComponent(SOLUTION_KEY_PREFIX + group.id)}`
      );
    }
  };

  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-vesper-6 py-vesper-10">
      <div className="flex flex-col gap-vesper-3">
        <div className="flex flex-wrap gap-vesper-2">
          {["Speech-to-Text", "Text Generation", "Text-to-Speech"].map(
            (tag) => (
              <Tag key={tag} size="sm" variant="accent-subtle">
                {tag}
              </Tag>
            )
          )}
        </div>
        <div className="flex items-center gap-vesper-3">
          <AIAgent className="w-7 h-7 text-vesper-icon-primary" aria-hidden />
          <Typography
            as="h2"
            variant="heading-sm"
            className="text-vesper-text-primary"
          >
            Voice Agent
          </Typography>
        </div>
        <Typography variant="copy-sm" className="text-vesper-text-secondary">
          Deploys the full voice pipeline: speech-to-text, an LLM and
          text-to-speech, each on its own device.
        </Typography>
      </div>

      {isResetting && (
        <Admonition variant="info" size="sm">
          Deployment is paused while the board resets.
        </Admonition>
      )}
      {insufficient && (
        <Admonition variant="danger" size="sm" subtle>
          This board has {totalSlots} {totalSlots === 1 ? "device" : "devices"},
          but the voice agent needs {plan.requiredSlots}.
        </Admonition>
      )}
      {!insufficient && conflicts.length > 0 && (
        <Admonition variant="warning" size="sm" subtle>
          {conflicts
            .map(
              (s) =>
                `${formatDeviceLabel(s.slot_id)} is in use${s.model_name ? ` by ${s.model_name}` : ""}`
            )
            .join(", ")}
          . Free these devices before deploying.
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
          {models.llm?.name} is gated on Hugging Face. Accept its licence with
          the account your token belongs to, then try again.
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
            Each model is assigned its own device automatically.
          </Typography>
        </div>
        {STAGES.map((stage) => (
          <label key={stage} className="flex flex-col gap-vesper-2">
            <span className="flex items-center justify-between gap-vesper-2">
              <Typography
                as="span"
                variant="label-sm"
                className="text-vesper-text-primary"
              >
                {STAGE_LABEL[stage]}
              </Typography>
              <Typography
                as="span"
                variant="label-xs-mono"
                className="text-vesper-text-tertiary"
              >
                {plan.slots[stage].map((s) => formatDeviceLabel(s)).join(" + ")}
              </Typography>
            </span>
            <Select
              aria-label={`${STAGE_LABEL[stage]} model`}
              placeholder={
                catalog.isPending ? "Loading…" : "No compatible model"
              }
              disabled={deploying || stageModels[stage].length === 0}
              options={stageModels[stage].map((m) => ({
                value: m.id,
                label: m.name,
              }))}
              value={selected[stage] || null}
              onValueChange={(value) =>
                setSelected((prev) => ({ ...prev, [stage]: value ?? "" }))
              }
            />
          </label>
        ))}
        <div className="flex flex-col gap-vesper-4 p-vesper-4 rounded-vesper-1 bg-vesper-tint-neutral-100">
          <Typography
            variant="label-sm-bold"
            className="text-vesper-text-primary"
          >
            Devices required: {plan.requiredSlots}
          </Typography>
          <div className="flex flex-wrap gap-vesper-3">
            {(chipStatus?.slots ?? []).map((slot) => (
              <DeviceChip
                key={slot.slot_id}
                deviceId={slot.slot_id}
                selected={targetSlots.includes(slot.slot_id)}
                disabled={slot.status !== "available"}
              />
            ))}
          </div>
        </div>
      </div>

      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={!canDeploy}
        iconLeft={deploying && <Spinner className="animate-spin" />}
        onClick={() => void handleDeploy()}
      >
        {deploying ? "Starting deployments" : "Deploy 3 models"}
      </Button>
    </div>
  );
}
