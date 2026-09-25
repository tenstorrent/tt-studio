// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Splits long audio into transcription-sized chunks.
 *
 * The speech-recognition server accepts a bounded amount of audio per request,
 * and Whisper itself works on 30-second windows. Rather than cut on a fixed
 * clock -- which slices words in half at every boundary -- each cut is nudged
 * to the quietest moment near its target, so chunks join cleanly and the
 * transcripts can simply be concatenated.
 */
import type { MonoPcm } from "../waveConverter";

// Nominal chunk length. Cuts land within BOUNDARY_SEARCH_SEC of this, so the
// longest possible chunk is CHUNK_TARGET_SEC + BOUNDARY_SEARCH_SEC -- kept
// under the 30s window the model is trained on.
export const CHUNK_TARGET_SEC = 25;
export const BOUNDARY_SEARCH_SEC = 2.5;
export const MAX_CHUNK_SEC = CHUNK_TARGET_SEC + BOUNDARY_SEARCH_SEC;

// Window used to measure loudness when hunting for a quiet cut point.
const FRAME_SEC = 0.02;

export interface AudioChunk {
  index: number;
  startSample: number;
  endSample: number;
  startSec: number;
  endSec: number;
}

/**
 * Divide decoded audio into chunks, cutting at the quietest point near each
 * target boundary. Audio shorter than one chunk yields a single chunk.
 */
export function planChunks(pcm: MonoPcm): AudioChunk[] {
  const { samples, sampleRate } = pcm;
  const total = samples.length;
  if (total === 0) return [];

  const targetLen = Math.round(CHUNK_TARGET_SEC * sampleRate);
  const searchLen = Math.round(BOUNDARY_SEARCH_SEC * sampleRate);
  const frameLen = Math.max(1, Math.round(FRAME_SEC * sampleRate));

  const chunks: AudioChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < total) {
    const target = start + targetLen;

    // Whatever is left fits inside one chunk, so stop splitting.
    if (target >= total - searchLen) {
      chunks.push(toChunk(index++, start, total, sampleRate));
      break;
    }

    const cut = quietestPoint(
      samples,
      target - searchLen,
      target + searchLen,
      frameLen
    );
    // Always make progress, even if the search returns something degenerate.
    const end = Math.min(total, Math.max(cut, start + frameLen));
    chunks.push(toChunk(index++, start, end, sampleRate));
    start = end;
  }

  return chunks;
}

function toChunk(
  index: number,
  startSample: number,
  endSample: number,
  sampleRate: number
): AudioChunk {
  return {
    index,
    startSample,
    endSample,
    startSec: startSample / sampleRate,
    endSec: endSample / sampleRate,
  };
}

/**
 * Find the sample offset of the quietest frame within [lo, hi).
 * Falls back to the midpoint when the range holds no complete frame.
 */
function quietestPoint(
  samples: Float32Array,
  lo: number,
  hi: number,
  frameLen: number
): number {
  const from = Math.max(0, lo);
  const to = Math.min(samples.length, hi);

  let bestRms = Number.POSITIVE_INFINITY;
  let bestAt = Math.floor((from + to) / 2);

  for (let frameStart = from; frameStart + frameLen <= to; frameStart += frameLen) {
    const rms = frameRms(samples, frameStart, frameLen);
    if (rms < bestRms) {
      bestRms = rms;
      bestAt = frameStart + Math.floor(frameLen / 2);
    }
  }

  return bestAt;
}

function frameRms(
  samples: Float32Array,
  start: number,
  frameLen: number
): number {
  const end = Math.min(start + frameLen, samples.length);
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  const count = end - start;
  return count > 0 ? Math.sqrt(sum / count) : 0;
}
