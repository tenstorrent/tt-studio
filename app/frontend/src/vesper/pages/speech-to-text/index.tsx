// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from "react";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Button } from "@tenstorrent/vesper/button";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Microphone, Spinner, Trash, Upload } from "@tenstorrent/vesper/icons";
import { ProgressBar } from "@tenstorrent/vesper/progress-bar";
import { TextButton } from "@tenstorrent/vesper/text-button";
import { addToast } from "@tenstorrent/vesper/toast";
import { Typography } from "@tenstorrent/vesper/typography";
import {
  sendAudioRecording,
  transcribeLongAudio,
  type LongAudioProgress,
} from "@/src/components/speechToText/lib/apiClient";
import { cn } from "@/src/lib/utils";
import { copyToClipboard } from "@/src/utils/clipboard";
import { getErrorMessage } from "@/src/utils/errors";
import { AudioPlayer } from "@/src/vesper/components/audio-player";
import { LevelMeter } from "@/src/vesper/components/level-meter";
import { ModelPicker } from "@/src/vesper/components/model-picker";
import {
  formatElapsed,
  useAudioRecorder,
} from "@/src/vesper/hooks/use-audio-recorder";
import { useHealthyModels } from "@/src/vesper/hooks/use-healthy-models";
import { formatDateTime } from "@/src/vesper/utils/format";

interface Transcription {
  id: string;
  createdAt: number;
  source: string;
  audioUrl: string;
  text: string;
  failedChunks?: number;
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}

export default function SpeechToTextPage() {
  const { models, isLoading, selected, setSelectedId } =
    useHealthyModels("speech_recognition");
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [busy, setBusy] = useState<LongAudioProgress | "recording" | null>(
    null
  );
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // release audio URLs when leaving the page
  const urls = useRef<string[]>([]);
  useEffect(
    () => () => urls.current.forEach((u) => URL.revokeObjectURL(u)),
    []
  );

  const addTranscription = (
    blob: Blob,
    source: string,
    text: string,
    failedChunks?: number
  ) => {
    const audioUrl = URL.createObjectURL(blob);
    urls.current.push(audioUrl);
    setTranscriptions((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: Date.now(),
        source,
        audioUrl,
        text,
        failedChunks,
      },
      ...prev,
    ]);
  };

  const transcribeRecording = async (blob: Blob) => {
    if (!selected) return;
    setBusy("recording");
    try {
      const data = await sendAudioRecording(blob, { modelID: selected.id });
      if (!data.text?.trim()) {
        addToast({
          variant: "warning",
          content: "No speech was detected in the recording.",
          timeout: 5000,
        });
        return;
      }
      addTranscription(blob, "Recording", data.text.trim());
    } catch (err) {
      addToast({
        variant: "danger",
        content: `Transcription failed: ${getErrorMessage(err)}`,
      });
    } finally {
      setBusy(null);
    }
  };

  const transcribeFile = async (file: File) => {
    if (!selected) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy({ phase: "decoding", done: 0, total: 0, text: "" });
    try {
      const result = await transcribeLongAudio(file, {
        modelID: selected.id,
        fileName: file.name,
        signal: controller.signal,
        onProgress: setBusy,
      });
      if (!result.text.trim()) {
        addToast({
          variant: "warning",
          content: "No speech was detected in that file.",
          timeout: 5000,
        });
        return;
      }
      addTranscription(
        file,
        file.name,
        result.text.trim(),
        result.failedChunks
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        addToast({
          variant: "danger",
          content: `Transcription failed: ${getErrorMessage(err)}`,
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  };

  const recorder = useAudioRecorder({
    onRecorded: (blob) => void transcribeRecording(blob),
  });
  const disabled = !selected || busy !== null;

  return (
    <div className="min-h-full flex flex-col items-center gap-vesper-8 p-vesper-10 text-left">
      <section className="w-full max-w-2xl flex flex-col gap-vesper-8 p-vesper-6 rounded-vesper-4 border border-vesper-border-secondary bg-vesper-background-primary">
        <header className="flex flex-col gap-vesper-2 text-center">
          <Typography
            as="h2"
            variant="heading-md"
            className="text-vesper-text-primary"
          >
            Speech to Text
          </Typography>
          <Typography variant="copy-md" className="text-vesper-text-secondary">
            Record your voice or upload audio, and transcribe it with a speech
            recognition model
          </Typography>
        </header>

        <ModelPicker
          models={models}
          isLoading={isLoading}
          value={selected?.id ?? null}
          onChange={setSelectedId}
          emptyText="No speech-to-text model is ready."
          disabled={busy !== null || recorder.recording}
        />

        <div className="flex flex-col items-center gap-vesper-5 px-vesper-6 py-vesper-8 rounded-vesper-2 bg-vesper-tint-neutral-100">
          {busy !== null && busy !== "recording" ? (
            <div className="w-full flex flex-col gap-vesper-3">
              <div className="flex items-center justify-between gap-vesper-3">
                <Typography
                  variant="label-sm-bold"
                  className="flex items-center gap-vesper-2 text-vesper-text-primary"
                >
                  <Spinner className="w-4 h-4 animate-spin" />
                  {busy.phase === "decoding"
                    ? "Decoding audio"
                    : `Transcribing part ${Math.min(busy.done + 1, busy.total)} of ${busy.total}`}
                </Typography>
                <TextButton
                  type="button"
                  size="sm"
                  variant="subtle"
                  onClick={() => abortRef.current?.abort()}
                >
                  Cancel
                </TextButton>
              </div>
              <ProgressBar
                size="sm"
                animated
                value={busy.total ? (busy.done / busy.total) * 100 : 0}
                aria-label="Transcription progress"
              />
              {busy.text && (
                <Typography
                  variant="copy-xs"
                  className="line-clamp-3 text-vesper-text-tertiary"
                >
                  {busy.text.slice(-300)}
                </Typography>
              )}
            </div>
          ) : busy === "recording" ? (
            <Typography
              variant="label-md-mono"
              className="flex items-center gap-vesper-2 text-vesper-text-secondary"
            >
              <Spinner className="w-4 h-4 animate-spin" />
              Transcribing your recording…
            </Typography>
          ) : (
            <>
              <LevelMeter
                levels={recorder.levels}
                active={recorder.recording}
              />
              <Typography
                variant="label-lg-bold"
                className="font-vesper-mono tabular-nums text-vesper-text-primary"
              >
                {formatElapsed(recorder.elapsedMs)}
              </Typography>
              <IconButton
                type="button"
                size="lg"
                variant={recorder.recording ? "danger" : "primary"}
                className="w-14 h-14 rounded-full"
                icon={recorder.recording ? <StopIcon /> : <Microphone />}
                aria-label={
                  recorder.recording ? "Stop recording" : "Start recording"
                }
                disabled={!recorder.recording && disabled}
                onClick={() =>
                  recorder.recording ? recorder.stop() : void recorder.start()
                }
              />
              <Typography
                variant="copy-sm"
                className="text-vesper-text-secondary"
              >
                {recorder.recording
                  ? "Click to stop recording"
                  : "Click the microphone to start recording"}
              </Typography>
              {recorder.recording ? (
                <TextButton
                  type="button"
                  size="sm"
                  variant="subtle"
                  onClick={recorder.cancel}
                >
                  Discard recording
                </TextButton>
              ) : (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.webm"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void transcribeFile(file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="subtle"
                    iconLeft={<Upload />}
                    disabled={disabled}
                    onClick={() => fileRef.current?.click()}
                  >
                    Upload audio file
                  </Button>
                </>
              )}
            </>
          )}
        </div>
        {recorder.error && (
          <Admonition variant="danger" size="sm">
            {recorder.error}
          </Admonition>
        )}
      </section>

      {transcriptions.length > 0 && (
        <section className="w-full max-w-2xl flex flex-col gap-vesper-4">
          <div className="flex items-center justify-between">
            <Typography
              as="h3"
              variant="heading-xs"
              className="text-vesper-text-primary"
            >
              Transcriptions
            </Typography>
            <TextButton
              type="button"
              size="sm"
              variant="subtle"
              onClick={() => setTranscriptions([])}
            >
              Clear all
            </TextButton>
          </div>
          <ul className="flex flex-col gap-vesper-4">
            {transcriptions.map((t) => (
              <li
                key={t.id}
                className="flex flex-col gap-vesper-4 p-vesper-4 rounded-vesper-2 border border-vesper-border-secondary bg-vesper-background-primary"
              >
                <div className="flex items-center justify-between gap-vesper-3">
                  <Typography
                    variant="label-xs-mono"
                    className="truncate text-vesper-text-tertiary"
                  >
                    {formatDateTime(t.createdAt)} · {t.source}
                  </Typography>
                  <div className="flex items-center gap-vesper-2">
                    <TextButton
                      type="button"
                      size="sm"
                      variant="subtle"
                      onClick={async () => {
                        const error = await copyToClipboard(t.text);
                        addToast(
                          error
                            ? {
                                variant: "danger",
                                content: `Couldn't copy: ${error}`,
                              }
                            : {
                                variant: "success",
                                content: "Transcription copied",
                                timeout: 3000,
                              }
                        );
                      }}
                    >
                      Copy
                    </TextButton>
                    <IconButton
                      type="button"
                      size="xs"
                      variant="ghost"
                      icon={<Trash />}
                      aria-label="Delete transcription"
                      onClick={() =>
                        setTranscriptions((prev) =>
                          prev.filter((x) => x.id !== t.id)
                        )
                      }
                    />
                  </div>
                </div>
                <AudioPlayer
                  src={t.audioUrl}
                  downloadName={
                    t.source === "Recording" ? "recording.webm" : t.source
                  }
                />
                <Typography
                  variant="copy-md"
                  className={cn("text-vesper-text-primary whitespace-pre-wrap")}
                >
                  {t.text}
                </Typography>
                {!!t.failedChunks && (
                  <Typography
                    variant="copy-xs"
                    className="text-vesper-text-warning"
                  >
                    {t.failedChunks} {t.failedChunks === 1 ? "part" : "parts"}{" "}
                    of the audio couldn't be transcribed.
                  </Typography>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
