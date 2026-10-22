// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useRef, useState } from "react";

const LEVEL_COUNT = 24;

/**
 * Records from the microphone with `MediaRecorder`, and exposes live input
 * levels for a visualizer while recording.
 */
export function useAudioRecorder({
  onRecorded,
}: {
  /** Called with the recording once it stops (not when cancelled) */
  onRecorded?(blob: Blob): void;
} = {}) {
  const [recording, setRecording] = useState(false);
  const [levels, setLevels] = useState<number[]>(() =>
    Array(LEVEL_COUNT).fill(0)
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const teardown = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    setLevels(Array(LEVEL_COUNT).fill(0));
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
      if (recorderRef.current?.state === "recording")
        recorderRef.current.stop();
      teardown();
    },
    [teardown]
  );

  const start = useCallback(async () => {
    if (recorderRef.current?.state === "recording") return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const context = new AudioContext();
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const bucket = Math.floor(data.length / LEVEL_COUNT) || 1;
        setLevels(
          Array.from({ length: LEVEL_COUNT }, (_, i) => {
            let sum = 0;
            for (let j = 0; j < bucket; j++) sum += data[i * bucket + j] ?? 0;
            return sum / bucket / 255;
          })
        );
        setElapsedMs(Date.now() - startedAtRef.current);
        frameRef.current = requestAnimationFrame(tick);
      };

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      cancelledRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        setRecording(false);
        teardown();
        if (cancelledRef.current) return;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        if (blob.size > 0) onRecordedRef.current?.(blob);
      };
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      recorder.start();
      setRecording(true);
      tick();
    } catch (err) {
      teardown();
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser to record."
          : "Couldn't start recording. Check that a microphone is connected."
      );
    }
  }, [teardown]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
  }, [stop]);

  return { recording, levels, elapsedMs, error, start, stop, cancel };
}

export function formatElapsed(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60
  ).padStart(2, "0")}`;
}
