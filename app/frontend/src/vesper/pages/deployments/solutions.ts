// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ChipStatus } from "@/src/types/chipStatus";
import { placementFor, profileForDevices } from "@/src/utils/deviceFit";
import {
  isLlama31_8BModel,
  isP300x2Board,
  isQwen3_8BModel,
} from "@/src/utils/p300x2Placement";
import type { CatalogModel } from "@/src/vesper/types";

// The voice agent prefers this LLM where the board runs it, then Qwen3-8B,
// then any Instruct model. Mirrors the original voice agent solution step.
const PREFERRED_VOICE_LLM = "Qwen3.5-9B";
const FALLBACK_VOICE_LLM = "Qwen3-8B";

export type VoiceAgentStage = "llm" | "stt" | "tts";

export const STAGE_MODEL_TYPE: Record<VoiceAgentStage, string> = {
  llm: "chat",
  stt: "speech_recognition",
  tts: "tts",
};

export const STAGE_LABEL: Record<VoiceAgentStage, string> = {
  llm: "LLM",
  stt: "Speech-to-Text",
  tts: "Text-to-Speech",
};

// Qwen3-8B and Llama-3.1-8B run across a whole P300 card, so on a P300x2 the
// LLM takes slots 0 and 1, pushing Whisper and SpeechT5 up by one.
const usesCardPairLlm = (name: string) =>
  isQwen3_8BModel(name) || isLlama31_8BModel(name);

/** Devices a model takes in the pipeline: 1, or 2 for a card pair; null when it needs more. */
function pipelineDevices(
  model: CatalogModel,
  totalSlots: number
): 1 | 2 | null {
  if (isP300x2Board(model.current_board) && usesCardPairLlm(model.name))
    return 2;
  const placement = placementFor(model, model.current_board, totalSlots);
  if (placement.allowsSingle) return 1;
  const groups = [...placement.cardGroups, ...(placement.pairGroups ?? [])];
  return groups.some((g) => g.length === 2) ? 2 : null;
}

function fitsStage(model: CatalogModel, totalSlots: number) {
  const devices = pipelineDevices(model, totalSlots);
  return model.model_type === "chat" ? devices !== null : devices === 1;
}

/** The catalog, with the voice agent's compatibility overrides applied. */
function voiceCatalog(catalog: CatalogModel[]) {
  // distil-large-v3 works in the pipeline even where the catalog says otherwise
  return catalog.map((m) =>
    /distil-large-v3/i.test(m.name) ? { ...m, is_compatible: true } : m
  );
}

/** Models eligible for each stage of the pipeline. */
export function getStageModels(catalog: CatalogModel[], totalSlots: number) {
  const models = voiceCatalog(catalog).filter((m) => m.is_compatible !== false);
  const forStage = (stage: VoiceAgentStage) =>
    models.filter(
      (m) =>
        m.model_type === STAGE_MODEL_TYPE[stage] && fitsStage(m, totalSlots)
    );
  return { llm: forStage("llm"), stt: forStage("stt"), tts: forStage("tts") };
}

export function getDefaultStageModels(
  stageModels: Record<VoiceAgentStage, CatalogModel[]>
): Record<VoiceAgentStage, string> {
  const compatible = (list: CatalogModel[]) =>
    list.filter((m) => m.is_compatible === true);
  const llms = compatible(stageModels.llm);
  const llm =
    llms.find((m) => m.name === PREFERRED_VOICE_LLM) ??
    llms.find((m) => m.name === FALLBACK_VOICE_LLM) ??
    llms.find((m) => /instruct/i.test(m.name)) ??
    llms[0] ??
    stageModels.llm[0];
  return {
    llm: llm?.id ?? "",
    stt: (compatible(stageModels.stt)[0] ?? stageModels.stt[0])?.id ?? "",
    tts: (compatible(stageModels.tts)[0] ?? stageModels.tts[0])?.id ?? "",
  };
}

export interface VoiceAgentPlan {
  /** Device slot(s) per stage */
  slots: Record<VoiceAgentStage, number[]>;
  requiredSlots: number;
  /** Model ids to deploy, accounting for serve profiles */
  deployIds: Record<VoiceAgentStage, string>;
}

/** Which device each stage of the pipeline is pinned to. */
export function planVoiceAgent(
  models: Record<VoiceAgentStage, CatalogModel | undefined>,
  totalSlots: number
): VoiceAgentPlan {
  const cardPair =
    !!models.llm && pipelineDevices(models.llm, totalSlots) === 2;
  const slots = cardPair
    ? { llm: [0, 1], stt: [2], tts: [3] }
    : { llm: [0], stt: [1], tts: [2] };
  const deployId = (model: CatalogModel | undefined, devices: number) =>
    model
      ? (profileForDevices(model, devices, totalSlots)?.id ?? model.id)
      : "";
  return {
    slots,
    requiredSlots: cardPair ? 4 : 3,
    deployIds: {
      llm: deployId(models.llm, cardPair ? 2 : 1),
      stt: deployId(models.stt, 1),
      tts: deployId(models.tts, 1),
    },
  };
}

/** Whether the voice agent solution can be deployed on this board right now. */
export function getVoiceAgentAvailability(
  catalog: CatalogModel[],
  chipStatus: ChipStatus | null
): { available: boolean; reason: string | null; devices: number } {
  const totalSlots = chipStatus?.total_slots ?? 4;
  const stageModels = getStageModels(catalog, totalSlots);
  const defaults = getDefaultStageModels(stageModels);
  const plan = planVoiceAgent(
    {
      llm: stageModels.llm.find((m) => m.id === defaults.llm),
      stt: stageModels.stt.find((m) => m.id === defaults.stt),
      tts: stageModels.tts.find((m) => m.id === defaults.tts),
    },
    totalSlots
  );
  const devices = plan.requiredSlots;

  if (!defaults.llm || !defaults.stt || !defaults.tts) {
    return {
      available: false,
      reason:
        "This board can't run an LLM, speech-to-text and text-to-speech model.",
      devices,
    };
  }
  if (chipStatus && totalSlots < plan.requiredSlots) {
    return {
      available: false,
      reason: `Needs ${plan.requiredSlots} devices; this board has ${totalSlots}.`,
      devices,
    };
  }
  const targetSlots = Object.values(plan.slots).flat();
  const busy = chipStatus?.slots.filter(
    (s) => targetSlots.includes(s.slot_id) && s.status === "occupied"
  );
  if (busy && busy.length > 0) {
    return {
      available: false,
      reason: `Devices ${busy.map((s) => s.slot_id + 1).join(", ")} are in use.`,
      devices,
    };
  }
  return { available: true, reason: null, devices };
}
