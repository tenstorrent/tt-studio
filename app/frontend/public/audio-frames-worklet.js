// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Emits 1280-sample int16 PCM frames at 16 kHz (80 ms each) via port.postMessage.
// Downsamples from the AudioContext's native rate using fractional decimation.

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 1280;

class AudioFramesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_SAMPLE_RATE;
    this.acc = 0;
    this.buffer = new Float32Array(FRAME_SIZE);
    this.bufferIdx = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        this.buffer[this.bufferIdx++] = channel[i];
        if (this.bufferIdx === FRAME_SIZE) {
          const int16 = new Int16Array(FRAME_SIZE);
          for (let j = 0; j < FRAME_SIZE; j++) {
            const s = Math.max(-1, Math.min(1, this.buffer[j]));
            int16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          this.port.postMessage(int16.buffer, [int16.buffer]);
          this.bufferIdx = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("audio-frames", AudioFramesProcessor);
