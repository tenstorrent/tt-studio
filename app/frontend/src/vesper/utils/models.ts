// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ComponentType, SVGProps } from "react";
import {
  AIModel,
  AIVideoGen,
  Chat,
  Document,
  Eye,
  Grid,
  Microphone,
  ModelDeepSeekColor,
  ModelFalconColor,
  ModelGoogleColor,
  ModelLlamaColor,
  ModelOpenAI,
  ModelQwenColor,
  Search,
  Tensix,
  User,
} from "@tenstorrent/vesper/icons";
import type { CatalogModel, DemoLink } from "@/src/vesper/types";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * The HF pipeline-style task label shown on model cards and used by the task
 * filter. Most backend model types map onto one task; CNNs are split between
 * classification and segmentation by name since the catalog doesn't say.
 */
export function getModelTask(model: Pick<CatalogModel, "model_type" | "name">) {
  const type = (model.model_type ?? "").toLowerCase();
  switch (type) {
    case "chat":
      return "Text Generation";
    case "vlm":
      return "Image-Text-to-Text";
    case "image_generation":
      return "Text-to-Image";
    case "video_generation":
      return "Text-to-Video";
    case "speech_recognition":
      return "Speech-to-Text";
    case "tts":
      return "Text-to-Speech";
    case "embedding":
      return "Embedding";
    case "object_detection":
      return "Object Detection";
    case "face_recognition":
      return "Face Recognition";
    case "training":
      return "Fine-tuning";
    case "cnn":
      return /segformer|unet/i.test(model.name)
        ? "Image Segmentation"
        : "Image Classification";
    default:
      return "Other";
  }
}

const ORG_NAMES: Record<string, string> = {
  "meta-llama": "Meta",
  google: "Google",
  qwen: "Alibaba",
  "wan-ai": "Alibaba",
  openai: "OpenAI",
  "distil-whisper": "Hugging Face",
  "deepseek-ai": "DeepSeek",
  mistralai: "Mistral AI",
  "black-forest-labs": "Black Forest Labs",
  stabilityai: "Stability AI",
  diffusers: "Hugging Face",
  microsoft: "Microsoft",
  baai: "BAAI",
  genmo: "Genmo",
  "motif-technologies": "Motif",
  "arcee-ai": "Arcee AI",
  tiiuae: "TII",
};

/** The organization publishing the model on Hugging Face, e.g. `meta-llama` */
function getHfOrg(hfModelId?: string | null) {
  if (!hfModelId || !hfModelId.includes("/")) return null;
  return hfModelId.split("/")[0].toLowerCase();
}

export function getModelOrgName(hfModelId?: string | null) {
  const org = getHfOrg(hfModelId);
  if (!org) return null;
  return ORG_NAMES[org] ?? hfModelId!.split("/")[0];
}

/** Brand logo for a model, falling back to a generic model icon. */
export function getModelLogo(
  hfModelId?: string | null,
  modelName?: string
): Icon {
  const org = getHfOrg(hfModelId);
  const name = (modelName ?? "").toLowerCase();
  if (org === "meta-llama" || name.startsWith("llama")) return ModelLlamaColor;
  if (org === "google" || name.startsWith("gemma")) return ModelGoogleColor;
  if (org === "qwen" || org === "wan-ai" || name.startsWith("qwen"))
    return ModelQwenColor;
  if (org === "deepseek-ai" || name.startsWith("deepseek"))
    return ModelDeepSeekColor;
  if (org === "tiiuae" || name.startsWith("falcon")) return ModelFalconColor;
  if (org === "openai" || name.startsWith("whisper") || name.startsWith("gpt"))
    return ModelOpenAI;
  return AIModel;
}

/**
 * Parameter count in billions, parsed from the model name since the catalog
 * doesn't carry one, e.g. `Llama-3.3-70B-Instruct` -> 70, `Qwen3-Embedding-0.6B`
 * -> 0.6, `Wan2.2-T2V-A14B` -> 14. Returns null when the name has no size.
 */
export function getModelSizeB(name: string): number | null {
  const matches = [
    ...name.matchAll(/(?:^|[-_ .])A?(\d+(?:\.\d+)?)\s*([bm])(?=$|[-_ .])/gi),
  ];
  if (matches.length === 0) return null;
  // the first size is the total size (e.g. `26B-A4B` is 26B total, 4B active)
  const [, value, unit] = matches[0];
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return unit.toLowerCase() === "m" ? n / 1000 : n;
}

export function formatModelSize(sizeB: number | null) {
  if (sizeB === null) return null;
  if (sizeB < 1) return `${Math.round(sizeB * 1000)}M`;
  return `${Number.isInteger(sizeB) ? sizeB : sizeB.toFixed(1)}B`;
}

/** Steps of the size filter range, in billions of parameters. */
export const SIZE_STEPS = [0, 1, 3, 8, 14, 32, 64, 128, 256, 500] as const;
export const SIZE_STEP_LABELS = [
  "<1B",
  "1B",
  "3B",
  "8B",
  "14B",
  "32B",
  "64B",
  "128B",
  "256B",
  ">500B",
];

export type Verification = "verified" | "unverified";

/**
 * The catalog has no notion of community vs official models (every entry comes
 * from tt-inference-server), so "TT-Verified" maps onto models whose support
 * status on Tenstorrent hardware is functional or complete.
 */
export function getVerification(
  model: Pick<CatalogModel, "status">
): Verification {
  return model.status === "COMPLETE" || model.status === "FUNCTIONAL"
    ? "verified"
    : "unverified";
}

const STATUS_COPY: Record<string, string> = {
  COMPLETE: "Fully supported",
  FUNCTIONAL: "Functional",
  EXPERIMENTAL: "Experimental",
};

/**
 * One line describing the model. The catalog carries no description, so this is
 * composed from the support status, publisher and parameter count.
 */
export function getModelDescription(model: CatalogModel) {
  const status = STATUS_COPY[model.status ?? ""] ?? "Experimental";
  const board =
    model.current_board && model.current_board !== "unknown"
      ? ` on ${model.current_board}`
      : "";
  const org = getModelOrgName(model.hf_model_id);
  const size = formatModelSize(getModelSizeB(model.name));
  const by = [org, size].filter(Boolean).join(", ");
  return `${status}${board}.${by ? ` ${by}.` : ""}`;
}

/** The demo pages a model of the given backend type can be used in. */
export function getDemosForModelType(modelType?: string | null): DemoLink[] {
  const type = (modelType ?? "").toLowerCase();
  switch (type) {
    case "chat":
    case "vlm":
      return [{ label: "Chat", href: "/chat", modelType: type }];
    case "tts":
      return [{ label: "Text to Speech", href: "/tts", modelType: type }];
    case "speech_recognition":
      return [
        { label: "Speech to Text", href: "/speech-to-text", modelType: type },
      ];
    case "image_generation":
      return [
        {
          label: "Image Generation",
          href: "/image-generation",
          modelType: type,
        },
      ];
    case "video_generation":
      return [
        {
          label: "Video Generation",
          href: "/video-generation",
          modelType: type,
        },
      ];
    case "object_detection":
    case "cnn":
      return [
        {
          label: "Object Detection",
          href: "/object-detection",
          modelType: type,
        },
      ];
    case "face_recognition":
      return [
        {
          label: "Face Recognition",
          href: "/face-recognition",
          modelType: type,
        },
      ];
    case "embedding":
      return [{ label: "Embedding", href: "/embedding", modelType: type }];
    case "training":
      return [{ label: "Fine-tuning", href: "/training", modelType: type }];
    case "unknown":
      return [];
    default:
      return [{ label: "Chat", href: "/chat", modelType: type }];
  }
}

export const VOICE_AGENT_DEMO: DemoLink = {
  label: "Voice Agent",
  href: "/voice-agent",
  modelType: "voice_agent",
};

/** Icon used for a demo link in the sidebar and demo lists. */
export function getDemoIcon(href: string): Icon {
  switch (href) {
    case "/chat":
      return Chat;
    case "/tts":
    case "/speech-to-text":
    case "/voice-agent":
      return Microphone;
    case "/image-generation":
      return Grid;
    case "/video-generation":
      return AIVideoGen;
    case "/object-detection":
      return Eye;
    case "/face-recognition":
      return User;
    case "/embedding":
      return Search;
    case "/training":
      return Tensix;
    default:
      return Document;
  }
}

/** `2` -> `D.02` */
export function formatDeviceLabel(deviceId: number, prefix = "D") {
  return `${prefix}.${String(deviceId + 1).padStart(2, "0")}`;
}

/** `2` -> `02` */
export function formatDeviceNumber(deviceId: number) {
  return String(deviceId + 1).padStart(2, "0");
}
