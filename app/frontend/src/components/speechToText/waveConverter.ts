// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Utility to convert audio blob to WAV format with proper RIFF header
 */

// Sample rate the speech-recognition models expect.
export const TARGET_SAMPLE_RATE = 16_000;

// Decoded, downmixed audio ready to be sliced and encoded.
export interface MonoPcm {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

// Check if the given blob is a WAV file
export function isWavFormat(blob: Blob): boolean {
  return blob.type === "audio/wav" || blob.type === "audio/x-wav";
}

/**
 * Decode any browser-decodable audio into mono PCM at the target sample rate.
 *
 * Decoding through an AudioContext pinned to the target rate means
 * decodeAudioData resamples for us, so no separate resampling pass is needed.
 * Exposed separately from encoding so callers that need to slice the audio
 * (long-file chunking) can decode once and re-use the samples.
 */
export async function decodeToMonoPcm(
  audioBlob: Blob,
  targetSampleRate = TARGET_SAMPLE_RATE
): Promise<MonoPcm> {
  const arrayBuffer = await audioBlob.arrayBuffer();

  const AudioContextCtor =
    window.AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioContextCtor({ sampleRate: targetSampleRate });

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return {
      samples: downmixToMono(audioBuffer),
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration,
    };
  } finally {
    // Browsers cap how many AudioContexts can exist at once, and long-file
    // transcription decodes repeatedly, so don't leak this one.
    if (audioContext.state !== "closed") {
      audioContext.close().catch((err) => {
        console.error("Error closing AudioContext after decode:", err);
      });
    }
  }
}

/**
 * Collapse an AudioBuffer to a single channel by averaging.
 *
 * Whisper works on mono audio, and sending mono halves the upload for stereo
 * sources. The microphone path is already mono, so this is a no-op there.
 */
export function downmixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) {
    return buffer.getChannelData(0);
  }

  const length = buffer.length;
  const mixed = new Float32Array(length);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      mixed[i] += data[i];
    }
  }
  for (let i = 0; i < length; i++) {
    mixed[i] /= channels;
  }
  return mixed;
}

/**
 * Encode a range of mono samples as a 16-bit PCM WAV blob.
 *
 * The range is taken with subarray(), which is a view rather than a copy, so
 * chunking an hour of audio doesn't duplicate the decoded PCM.
 */
export function encodeWavRange(
  samples: Float32Array,
  sampleRate: number,
  startSample = 0,
  endSample = samples.length
): Blob {
  const start = Math.max(0, Math.min(startSample, samples.length));
  const end = Math.max(start, Math.min(endSample, samples.length));
  return encodeWAV(samples.subarray(start, end), 1, sampleRate, 1, 16);
}

/**
 * Convert any audio blob to a mono WAV blob at the target sample rate.
 *
 * Kept as the single-shot entry point used by the microphone paths.
 */
export async function convertToWav(
  audioBlob: Blob,
  targetSampleRate = TARGET_SAMPLE_RATE
): Promise<Blob> {
  const { samples, sampleRate } = await decodeToMonoPcm(
    audioBlob,
    targetSampleRate
  );
  return encodeWavRange(samples, sampleRate);
}

// Encode audio data as WAV format with proper RIFF header
function encodeWAV(
  samples: Float32Array,
  format: number,
  sampleRate: number,
  numChannels: number,
  bitDepth: number
): Blob {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  // Create buffer with appropriate size for header and data
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  // RIFF identifier ('RIFF')
  writeString(view, 0, "RIFF");
  // RIFF chunk size
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  // RIFF type ('WAVE')
  writeString(view, 8, "WAVE");
  // Format chunk identifier ('fmt ')
  writeString(view, 12, "fmt ");
  // Format chunk size
  view.setUint32(16, 16, true);
  // Sample format (PCM)
  view.setUint16(20, format, true);
  // Channel count
  view.setUint16(22, numChannels, true);
  // Sample rate
  view.setUint32(24, sampleRate, true);
  // Byte rate (sample rate * block align)
  view.setUint32(28, sampleRate * blockAlign, true);
  // Block align (channel count * bytes per sample)
  view.setUint16(32, blockAlign, true);
  // Bits per sample
  view.setUint16(34, bitDepth, true);
  // Data chunk identifier ('data')
  writeString(view, 36, "data");
  // Data chunk size
  view.setUint32(40, samples.length * bytesPerSample, true);

  // Write the PCM samples
  if (bitDepth === 16) {
    floatTo16BitPCM(view, 44, samples);
  } else {
    floatTo8BitPCM(view, 44, samples);
  }

  // Return blob with WAV MIME type
  return new Blob([buffer], { type: "audio/wav" });
}

// Write a string to a DataView at the specified offset
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Convert float audio data to 16-bit PCM
function floatTo16BitPCM(
  output: DataView,
  offset: number,
  input: Float32Array
): void {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

// Convert float audio data to 8-bit PCM
function floatTo8BitPCM(
  output: DataView,
  offset: number,
  input: Float32Array
): void {
  for (let i = 0; i < input.length; i++, offset++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setUint8(offset, (s < 0 ? s * 128 : s * 127) + 128);
  }
}
