// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * API client for sending audio recordings to a server
 */
import { convertToWav, decodeToMonoPcm, encodeWavRange } from "../waveConverter";
import { planChunks, type AudioChunk } from "./chunker";

// Configuration type for the API client
export interface ApiConfig {
  // The base URL for the API
  baseUrl: string;
  // Optional authentication token
  authToken?: string;
  // Optional headers to include with requests
  headers?: Record<string, string>;
  // Optional timeout in milliseconds
  timeout?: number;
}

// Default configuration - use the proxy URL to avoid CORS issues
const DEFAULT_CONFIG: ApiConfig = {
  // Use the proxy endpoint defined in vite.config.ts to avoid CORS issues
  baseUrl: "/models-api/speech-recognition/",
  // Generous: a single chunk of speech can take a while on busy hardware, and
  // a client-side abort mid-run would discard work already done.
  timeout: 300_000,
};

// Current configuration
let currentConfig: ApiConfig = { ...DEFAULT_CONFIG };

/**
 * Decoding options sent with every transcription request.
 *
 * These are Whisper's standard temperature-fallback and failed-decode
 * thresholds. Passing them explicitly enables retry-on-failed-decode, which is
 * the main defence against repetition loops on long audio.
 */
const DECODE_OPTIONS: Record<string, string> = {
  temperatures: "0.0,0.2,0.4,0.6,0.8,1.0",
  compression_ratio_threshold: "2.4",
  logprob_threshold: "-1.0",
  no_speech_threshold: "0.6",
  stream: "false",
};
// return_timestamps is deliberately not requested: chunk offsets already give
// per-segment times, and asking for timestamps changes the response shape for
// no gain here. The backend still forwards the field if it is ever needed.

// Seed each chunk with the tail of the previous transcript so the model keeps
// context across chunk boundaries. Set false to transcribe each chunk blind.
const PROMPT_CARRY_OVER = true;
// Whisper's prompt window is small; keep well inside it.
const PROMPT_MAX_CHARS = 200;
// A failed chunk shouldn't discard the whole run.
const CHUNK_ATTEMPTS = 3;

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
  failed?: boolean;
}

export interface LongAudioProgress {
  phase: "decoding" | "transcribing";
  done: number;
  total: number;
  text: string;
}

export interface LongAudioResult {
  text: string;
  segments: TranscriptSegment[];
  failedChunks: number;
  durationSec: number;
}

/**
 * Configure the API client
 */
export function configureApi(config: Partial<ApiConfig>): void {
  currentConfig = {
    ...currentConfig,
    ...config,
  };
}

/**
 * Get the current API configuration
 */
export function getApiConfig(): ApiConfig {
  return { ...currentConfig };
}

/**
 * Pick the deployed-model endpoint or the cloud one, matching how the backend
 * routes speech recognition.
 */
function resolveEndpoint(modelID?: string | null): string {
  const apiUrlDefined = import.meta.env.VITE_ENABLE_DEPLOYED === "true";
  const useCloudEndpoint = !modelID || modelID === "null" || apiUrlDefined;
  return useCloudEndpoint
    ? "/models-api/speech-recognition-cloud/"
    : "/models-api/speech-recognition/";
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  if (currentConfig.authToken) {
    headers["Authorization"] = currentConfig.authToken;
  }

  if (currentConfig.headers) {
    Object.entries(currentConfig.headers).forEach(([key, value]) => {
      headers[key] = value;
    });
  }

  return headers;
}

interface PostAudioOptions {
  modelID?: string | null;
  prompt?: string;
  fileName?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * POST a single WAV blob for transcription and return the parsed response.
 */
async function postAudio(wavBlob: Blob, options: PostAudioOptions = {}) {
  const {
    modelID,
    prompt,
    fileName = "recording.wav",
    timeoutMs = currentConfig.timeout,
    signal,
  } = options;

  const formData = new FormData();
  // "file" is the field name the API expects.
  formData.append("file", wavBlob, fileName);

  if (modelID) {
    formData.append("deploy_id", modelID);
  }

  Object.entries(DECODE_OPTIONS).forEach(([key, value]) => {
    formData.append(key, value);
  });

  if (prompt) {
    formData.append("prompt", prompt);
  }

  // Abort on timeout, but also honour a caller-supplied cancellation.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller);

  const endpoint = resolveEndpoint(modelID);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(),
      body: formData,
      signal: controller.signal,
    });

    const responseText = await response.text();
    let data: any;

    try {
      data = JSON.parse(responseText);
    } catch {
      data = null;
    }

    if (!response.ok) {
      // The backend forwards the upstream error body, so prefer it over a
      // bare status code.
      const detail =
        (data && (data.error || data.detail)) ||
        responseText.slice(0, 300) ||
        `HTTP ${response.status}`;
      throw new Error(detail);
    }

    if (!data) {
      throw new Error("The transcription service returned an unreadable response.");
    }

    if (!data.text && data.transcription) {
      data.text = data.transcription;
    } else if (!data.text) {
      data.text = "";
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        signal?.aborted ? "Transcription cancelled" : "Request timed out"
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Send an audio recording to the server
 *
 * Single-shot path used by the microphone recorders. Long uploaded files go
 * through transcribeLongAudio instead.
 */
export async function sendAudioRecording(
  audioBlob: Blob,
  metadata?: Record<string, any>
) {
  // Always convert: the API needs mono 16kHz WAV regardless of what the
  // recorder or the file happened to be.
  let processedBlob: Blob;
  try {
    processedBlob = await convertToWav(audioBlob);
  } catch (error) {
    console.error("Failed to convert to WAV:", error);
    throw new Error(
      "Could not decode that audio. Try a WAV, MP3, M4A, FLAC, OGG, or WebM file."
    );
  }

  return postAudio(processedBlob, {
    modelID: metadata?.modelID,
    fileName: metadata?.fileName,
  });
}

/**
 * Transcribe an audio file of any length.
 *
 * The file is decoded once, split at quiet points into chunks the model can
 * accept, then transcribed one chunk at a time. Each request carries the tail
 * of the previous chunk's transcript as a prompt so the model keeps context
 * across boundaries -- requests are deliberately sequential for that reason.
 */
export async function transcribeLongAudio(
  file: Blob,
  options: {
    modelID?: string | null;
    fileName?: string;
    onProgress?: (progress: LongAudioProgress) => void;
    signal?: AbortSignal;
  } = {}
): Promise<LongAudioResult> {
  const { modelID, fileName, onProgress, signal } = options;

  onProgress?.({ phase: "decoding", done: 0, total: 0, text: "" });

  let pcm;
  try {
    pcm = await decodeToMonoPcm(file);
  } catch (error) {
    console.error("Failed to decode audio:", error);
    throw new Error(
      "Could not decode that audio. Try a WAV, MP3, M4A, FLAC, OGG, or WebM file."
    );
  }

  const chunks = planChunks(pcm);
  if (chunks.length === 0) {
    throw new Error("That file contains no audio.");
  }

  const segments: TranscriptSegment[] = [];
  let transcript = "";
  let failedChunks = 0;
  // Dropped for one chunk when the previous chunk's output looks degenerate,
  // so a repetition loop isn't fed forward into the next window.
  let carryPrompt = true;

  onProgress?.({
    phase: "transcribing",
    done: 0,
    total: chunks.length,
    text: "",
  });

  for (const chunk of chunks) {
    if (signal?.aborted) {
      throw new Error("Transcription cancelled");
    }

    const text = await transcribeChunk(chunk, {
      pcm,
      modelID,
      fileName,
      signal,
      prompt:
        PROMPT_CARRY_OVER && carryPrompt ? promptTail(transcript) : undefined,
    });

    if (text === null) {
      failedChunks += 1;
      segments.push({
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        text: "",
        failed: true,
      });
      carryPrompt = false;
    } else {
      segments.push({
        startSec: chunk.startSec,
        endSec: chunk.endSec,
        text,
      });
      if (text) {
        transcript = transcript ? `${transcript} ${text}` : text;
      }
      carryPrompt = !looksDegenerate(text);
    }

    onProgress?.({
      phase: "transcribing",
      done: segments.length,
      total: chunks.length,
      text: transcript,
    });
  }

  return {
    text: transcript,
    segments,
    failedChunks,
    durationSec: pcm.duration,
  };
}

/**
 * Transcribe one chunk, retrying transient failures.
 * Returns null when every attempt failed, so the run can continue.
 */
async function transcribeChunk(
  chunk: AudioChunk,
  context: {
    pcm: { samples: Float32Array; sampleRate: number };
    modelID?: string | null;
    fileName?: string;
    prompt?: string;
    signal?: AbortSignal;
  }
): Promise<string | null> {
  const { pcm, modelID, fileName, prompt, signal } = context;

  const wavBlob = encodeWavRange(
    pcm.samples,
    pcm.sampleRate,
    chunk.startSample,
    chunk.endSample
  );

  let lastError: unknown;

  for (let attempt = 1; attempt <= CHUNK_ATTEMPTS; attempt++) {
    if (signal?.aborted) {
      throw new Error("Transcription cancelled");
    }

    try {
      const data = await postAudio(wavBlob, {
        modelID,
        prompt,
        fileName: chunkFileName(fileName, chunk.index),
        signal,
      });
      return typeof data.text === "string" ? data.text.trim() : "";
    } catch (error) {
      // A cancellation is deliberate; don't burn retries on it.
      if (error instanceof Error && error.message === "Transcription cancelled") {
        throw error;
      }
      lastError = error;
      console.warn(
        `Chunk ${chunk.index + 1} attempt ${attempt}/${CHUNK_ATTEMPTS} failed:`,
        error
      );
    }
  }

  console.error(`Chunk ${chunk.index + 1} failed after ${CHUNK_ATTEMPTS} attempts:`, lastError);
  return null;
}

/**
 * The payload is always WAV, so keep the original stem for backend logs but
 * force the extension to match what is actually being sent.
 */
function chunkFileName(fileName: string | undefined, index: number): string {
  if (!fileName) return `chunk-${index + 1}.wav`;
  const stem =
    fileName
      .replace(/\.[^./\\]+$/, "")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 64) || "upload";
  return `${stem}-${index + 1}.wav`;
}

/**
 * Last few words of the transcript so far, trimmed to a word boundary.
 */
function promptTail(transcript: string): string | undefined {
  if (!transcript) return undefined;
  const tail = transcript.slice(-PROMPT_MAX_CHARS);
  // Drop a leading partial word when the slice landed mid-word.
  const trimmed =
    tail.length < transcript.length ? tail.replace(/^\S*\s+/, "") : tail;
  return trimmed.trim() || undefined;
}

/**
 * Detect the repetition loops Whisper falls into, so a bad chunk isn't fed
 * forward as the next chunk's prompt.
 */
function looksDegenerate(text: string): boolean {
  const words = text.toLowerCase().match(/\S+/g);
  if (!words || words.length < 12) return false;
  const unique = new Set(words).size;
  return unique / words.length < 0.25;
}
