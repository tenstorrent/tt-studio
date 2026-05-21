// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef } from "react";

type WakeEvent = { model: string; score: number };

type UseWakeWordOptions = {
  enabled: boolean;
  onWake: (event: WakeEvent) => void;
};

const WS_URL = `${window.location.protocol === "https:" ? "wss" : "ws"
  }://${window.location.host}/ws-api/wakeword/`;

export function useWakeWord({ enabled, onWake }: UseWakeWordOptions) {
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let workletNode: AudioWorkletNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let ws: WebSocket | null = null;

    const cleanup = () => {
      cancelled = true;
      try {
        workletNode?.disconnect();
      } catch { }
      try {
        source?.disconnect();
      } catch { }
      if (ctx && ctx.state !== "closed") ctx.close().catch(() => { });
      stream?.getTracks().forEach((t) => t.stop());
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return cleanup();

        const AudioCtx =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new AudioCtx();
        await ctx.audioWorklet.addModule("/audio-frames-worklet.js");
        if (cancelled) return cleanup();

        ws = new WebSocket(WS_URL);
        ws.binaryType = "arraybuffer";
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.event === "wake") {
              onWakeRef.current({ model: data.model, score: data.score });
            }
          } catch {
            /* malformed payload — ignore */
          }
        };
        ws.onerror = (e) => console.warn("wake-word: ws error", e);

        workletNode = new AudioWorkletNode(ctx, "audio-frames");
        workletNode.port.onmessage = (e) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            console.log("wake-word: sending data", e.data);
            ws.send(e.data);
          }
        };

        source = ctx.createMediaStreamSource(stream);
        source.connect(workletNode);
      } catch (err) {
        console.warn("wake-word: setup failed", err);
        cleanup();
      }
    })();

    return cleanup;
  }, [enabled]);
}
