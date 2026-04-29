// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export interface ParsedLogInfo {
  hf_model_id?: string;
  model_type?: string;
  port?: number;
}

const MODEL_TYPE_MAP: [string[], string][] = [
  [["whisper", "wav2vec", "speech", "asr"], "speech_recognition"],
  [["llava", "clip", "idefics", "vision", "blip"], "vlm"],
  [["stable-diffusion", "sdxl", "dall-e"], "image_generation"],
  [["xtts", "-tts-", "bark", "speecht5", "fastspeech"], "tts"],
  [["-e5-", "/e5-", "gte-", "bge-", "embed", "sentence-t5"], "embedding"],
];

function inferModelType(hfId: string): string {
  const lower = hfId.toLowerCase();
  for (const [keywords, type] of MODEL_TYPE_MAP) {
    if (keywords.some((k) => lower.includes(k))) return type;
  }
  return "chat";
}

export function parseVllmLogs(text: string): ParsedLogInfo {
  const result: ParsedLogInfo = {};

  const modelMatch = text.match(/\bmodel='([^']+)'/);
  if (modelMatch) {
    result.hf_model_id = modelMatch[1];
    result.model_type = inferModelType(modelMatch[1]);
  }

  const portMatch = text.match(/Uvicorn running on http:\/\/[^:]+:(\d+)/i);
  if (portMatch) result.port = parseInt(portMatch[1], 10);

  return result;
}
