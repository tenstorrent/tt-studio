/**
 * Utility to convert audio blob to WAV format with proper RIFF header
 */

// Check if the given blob is a WAV file
export function isWavFormat(blob: Blob): boolean {
  return blob.type === "audio/wav" || blob.type === "audio/x-wav";
}

// Function to convert any audio blob to WAV format with a specific sample rate
export async function convertToWav(
  audioBlob: Blob,
  targetSampleRate = 16_000 // 16kHz
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Create a new FileReader
    const reader = new FileReader();

    // Set up the onload event handler
    reader.onload = async (event) => {
      try {
        // Get the audio context
        const AudioContext =
          window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContext({ sampleRate: targetSampleRate });

        // Decode the audio data
        const arrayBuffer = event.target?.result as ArrayBuffer;
        if (!arrayBuffer) {
          throw new Error("Failed to read audio file");
        }

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Check if we need to resample
        if (audioBuffer.sampleRate !== targetSampleRate) {
          console.log(
            `Resampling from ${audioBuffer.sampleRate}Hz to ${targetSampleRate}Hz`
          );
          const resampledBuffer = await resampleAudio(
            audioBuffer,
            targetSampleRate
          );
          const wavBlob = audioBufferToWav(resampledBuffer, targetSampleRate);
          resolve(wavBlob);
        } else {
          // No resampling needed
          const wavBlob = audioBufferToWav(audioBuffer, targetSampleRate);
          resolve(wavBlob);
        }
      } catch (error) {
        console.error("Audio conversion error:", error);
        reject(error);
      }
    };

    // Set up the onerror event handler
    reader.onerror = (error) => {
      console.error("Error reading audio file:", error);
      reject(new Error("Error reading audio file"));
    };

    // Read the audio data as an ArrayBuffer
    reader.readAsArrayBuffer(audioBlob);
  });
}

// Resample audio to a different sample rate
async function resampleAudio(
  audioBuffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  const numChannels = audioBuffer.numberOfChannels;
  const originalSampleRate = audioBuffer.sampleRate;
  const originalLength = audioBuffer.length;

  // Calculate new length based on ratio of sample rates
  const targetLength = Math.round(
    (originalLength * targetSampleRate) / originalSampleRate
  );

  // Create offline context for resampling
  const offlineContext = new OfflineAudioContext(
    numChannels,
    targetLength,
    targetSampleRate
  );

  // Create buffer source
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);

  // Start the source and render
  source.start(0);

  // Return a promise that resolves with the resampled buffer
  return await offlineContext.startRendering();
}

// Function to convert AudioBuffer to WAV blob
function audioBufferToWav(buffer: AudioBuffer, sampleRate: number): Blob {
  const numberOfChannels = buffer.numberOfChannels;
  const format = 1; // PCM format
  const bitDepth = 16; // 16-bit audio

  // Get audio data
  let result: Float32Array;
  if (numberOfChannels === 2) {
    // Stereo - interleave the two channels
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    // Mono or other - just use the first channel
    result = buffer.getChannelData(0);
  }

  // Encode as WAV
  return encodeWAV(result, format, sampleRate, numberOfChannels, bitDepth);
}

// Interleave two audio channels
function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);

  let index = 0;
  let inputIndex = 0;

  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }

  return result;
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
