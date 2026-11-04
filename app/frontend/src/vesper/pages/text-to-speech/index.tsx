// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import { Button } from "@tenstorrent/vesper/button";
import { Spinner } from "@tenstorrent/vesper/icons";
import { TextArea } from "@tenstorrent/vesper/text-area";
import { addToast } from "@tenstorrent/vesper/toast";
import { Typography } from "@tenstorrent/vesper/typography";
import { runTTSInference } from "@/src/api/modelsDeployedApis";
import { getErrorMessage } from "@/src/utils/errors";
import { AudioPlayer } from "@/src/vesper/components/audio-player";
import { ModelPicker } from "@/src/vesper/components/model-picker";
import { useHealthyModels } from "@/src/vesper/hooks/use-healthy-models";

export default function TextToSpeechPage() {
  const { models, isLoading, selected, setSelectedId } =
    useHealthyModels("tts");
  const [text, setText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [audio, setAudio] = useState<{ url: string; text: string } | null>(
    null
  );

  // release the previous clip's object URL
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio.url);
    },
    [audio]
  );

  const canGenerate = !!selected && text.trim().length > 0 && !generating;

  const generate = async () => {
    if (!selected || !canGenerate) return;
    setGenerating(true);
    try {
      const blob = await runTTSInference(selected.id, text.trim());
      setAudio({ url: URL.createObjectURL(blob), text: text.trim() });
    } catch (err) {
      addToast({
        variant: "danger",
        content: `Couldn't generate audio: ${getErrorMessage(err)}`,
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-vesper-10 text-left">
      <section className="w-full max-w-lg flex flex-col gap-vesper-8 p-vesper-6 rounded-vesper-4 border border-vesper-border-secondary bg-vesper-background-primary">
        <header className="flex flex-col gap-vesper-2 text-center">
          <Typography
            as="h2"
            variant="heading-md"
            className="text-vesper-text-primary"
          >
            Text to Speech
          </Typography>
          <Typography variant="copy-md" className="text-vesper-text-secondary">
            Type text below and generate audio using a TTS model
          </Typography>
        </header>

        <ModelPicker
          models={models}
          isLoading={isLoading}
          value={selected?.id ?? null}
          onChange={setSelectedId}
          emptyText="No text-to-speech model is ready."
          disabled={generating}
        />

        <label className="flex flex-col gap-vesper-2">
          <Typography
            as="span"
            variant="label-sm"
            className="text-vesper-text-secondary"
          >
            Text to synthesize
          </Typography>
          <TextArea
            height={120}
            placeholder="Write text here…"
            value={text}
            disabled={generating}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void generate();
              }
            }}
          />
          <Typography
            as="span"
            variant="label-xs"
            className="text-vesper-text-tertiary"
          >
            <strong className="font-medium text-vesper-text-secondary">
              Enter
            </strong>{" "}
            to generate ·{" "}
            <strong className="font-medium text-vesper-text-secondary">
              Shift + Enter
            </strong>{" "}
            for a new line
          </Typography>
        </label>

        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={!canGenerate}
          iconLeft={generating && <Spinner className="animate-spin" />}
          onClick={() => void generate()}
        >
          {generating ? "Generating audio" : "Generate audio"}
        </Button>

        {audio && (
          <div className="flex flex-col gap-vesper-2">
            <Typography
              variant="label-sm"
              className="text-vesper-text-secondary"
            >
              Generated audio
            </Typography>
            <AudioPlayer src={audio.url} autoPlay downloadName="speech.wav" />
            <Typography
              variant="copy-xs"
              className="line-clamp-2 text-vesper-text-tertiary"
            >
              “{audio.text}”
            </Typography>
          </div>
        )}
      </section>
    </div>
  );
}
