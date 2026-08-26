// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from "react";
import { MicVAD } from "@ricky0123/vad-web";

type UseSilenceDetectionOptions = {
  enabled: boolean;
  onSilence: () => void;
};

export function useSilenceDetection({
  enabled,
  onSilence,
}: UseSilenceDetectionOptions) {
  const onSilenceRef = useRef(onSilence);
  onSilenceRef.current = onSilence;

  const vadRef = useRef<MicVAD | null>(null);
  const [ready, setReady] = useState(false);

  // Build the detector once, on mount. MicVAD.new() fetches and compiles ~15 MB of
  // ONNX runtime plus the Silero model, so doing it per recording meant the VAD only
  // came alive well after the user had started talking. The library only emits
  // onSpeechEnd to close a speech segment it saw *begin*, so a detector that starts
  // mid-utterance sees silence, never pairs a start with an end, and the recorder
  // runs forever. Loading up front means it is already listening on the first frame.
  //
  // startOnLoad:false keeps the microphone closed until a recording actually starts —
  // new() only loads the model, start() is what opens the mic.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const vad = await MicVAD.new({
          baseAssetPath: "/",
          onnxWASMBasePath: "/",
          startOnLoad: false,
          onSpeechEnd: () => onSilenceRef.current(),
        });
        if (cancelled) {
          vad.destroy();
          return;
        }
        vadRef.current = vad;
        setReady(true);
      } catch (err) {
        console.warn("silence-detection: setup failed", err);
      }
    })();

    return () => {
      cancelled = true;
      vadRef.current?.destroy();
      vadRef.current = null;
      setReady(false);
    };
  }, []);

  // Gate listening on the recorder. start() on an already-initialised detector just
  // reconnects the mic and resumes the frame processor, so it is cheap enough to run
  // inline with the recording rather than racing it.
  useEffect(() => {
    const vad = vadRef.current;
    if (!ready || !vad) return;

    (async () => {
      try {
        if (enabled) await vad.start();
        else await vad.pause();
      } catch (err) {
        console.warn("silence-detection: could not toggle listening", err);
      }
    })();
  }, [enabled, ready]);
}
