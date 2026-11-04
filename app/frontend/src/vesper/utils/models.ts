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

/** The organization publishing the model on Hugging Face, e.g. `meta-llama` */
function getHfOrg(hfModelId?: string | null) {
  if (!hfModelId || !hfModelId.includes("/")) return null;
  return hfModelId.split("/")[0].toLowerCase();
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
