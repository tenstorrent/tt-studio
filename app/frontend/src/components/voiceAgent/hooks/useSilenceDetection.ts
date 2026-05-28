// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef } from "react";
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

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let vad: MicVAD | null = null;

    (async () => {
      try {
        vad = await MicVAD.new({
          baseAssetPath: "/",
          onnxWASMBasePath: "/",
          onSpeechEnd: () => onSilenceRef.current(),
        });
        if (cancelled) {
          vad.destroy();
          return;
        }
        await vad.start();
      } catch (err) {
        console.warn("silence-detection: setup failed", err);
      }
    })();

    return () => {
      cancelled = true;
      vad?.destroy();
    };
  }, [enabled]);
}
