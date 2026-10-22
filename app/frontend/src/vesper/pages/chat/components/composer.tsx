// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useRef, useState } from "react";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import {
  Add,
  ArrowUp,
  Close,
  Document,
  Microphone,
  Spinner,
} from "@tenstorrent/vesper/icons";
import { Tag } from "@tenstorrent/vesper/tag";
import { addToast } from "@tenstorrent/vesper/toast";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { Typography } from "@tenstorrent/vesper/typography";
import type { FileData } from "@/src/components/chatui/types";
import { sendAudioRecording } from "@/src/components/speechToText/lib/apiClient";
import { cn } from "@/src/lib/utils";
import { getErrorMessage } from "@/src/utils/errors";
import { LevelMeter } from "@/src/vesper/components/level-meter";
import {
  formatElapsed,
  useAudioRecorder,
} from "@/src/vesper/hooks/use-audio-recorder";

const TEXT_EXTENSIONS =
  /\.(txt|md|csv|json|xml|ya?ml|log|py|js|jsx|ts|tsx|html|css|sh)$/i;

function readFile(file: File): Promise<FileData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
    if (file.type.startsWith("image/")) {
      reader.onload = () =>
        resolve({
          name: file.name,
          type: "image_url",
          size: file.size,
          mime_type: file.type,
          image_url: { url: reader.result as string },
        });
      reader.readAsDataURL(file);
    } else if (
      file.type.startsWith("text/") ||
      TEXT_EXTENSIONS.test(file.name)
    ) {
      reader.onload = () =>
        resolve({
          name: file.name,
          type: "text",
          size: file.size,
          text: reader.result as string,
        });
      reader.readAsText(file);
    } else {
      reject(new Error(`${file.name} isn't an image or a text file.`));
    }
  });
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}

export function Composer({
  modelName,
  disabled,
  streaming,
  allowImages,
  sttModelId,
  onSend,
  onStop,
}: {
  modelName: string | null;
  disabled: boolean;
  streaming: boolean;
  /** Whether the model accepts images (vision models) */
  allowImages: boolean;
  /** A deployed speech-to-text model for voice input, if any */
  sttModelId: string | null;
  onSend(text: string, files: FileData[]): void;
  onStop(): void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileData[]>([]);
  const [transcribing, setTranscribing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const recorder = useAudioRecorder({
    onRecorded: async (blob) => {
      if (!sttModelId) return;
      setTranscribing(true);
      try {
        const data = await sendAudioRecording(blob, { modelID: sttModelId });
        const spoken = (data.text ?? "").trim();
        if (spoken) setText((prev) => (prev ? `${prev} ${spoken}` : spoken));
      } catch (err) {
        addToast({
          variant: "danger",
          content: `Voice input failed: ${getErrorMessage(err)}`,
        });
      } finally {
        setTranscribing(false);
      }
    },
  });

  const canSend =
    !disabled && !streaming && (text.trim().length > 0 || files.length > 0);
  const submit = () => {
    if (!canSend) return;
    onSend(text, files);
    setText("");
    setFiles([]);
  };

  const attach = async (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      try {
        const data = await readFile(file);
        if (data.type === "image_url" && !allowImages) {
          addToast({
            variant: "warning",
            content: `${modelName ?? "This model"} can't read images. Deploy a vision model to chat about images.`,
            timeout: 6000,
          });
          continue;
        }
        setFiles((prev) => [...prev, data]);
      } catch (err) {
        addToast({
          variant: "warning",
          content: getErrorMessage(err),
          timeout: 6000,
        });
      }
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-vesper-6 pb-vesper-6">
      <div
        className={cn(
          "flex flex-col gap-vesper-3 p-vesper-4 rounded-vesper-2 border bg-vesper-background-primary",
          "border-vesper-border-secondary focus-within:border-vesper-border-primary"
        )}
      >
        {files.length > 0 && (
          <div className="flex flex-wrap gap-vesper-2">
            {files.map((file, i) => (
              <Tag
                key={`${file.name}-${i}`}
                size="md"
                icon={
                  file.type === "image_url" && file.image_url ? (
                    <img
                      src={file.image_url.url}
                      alt=""
                      className="w-4 h-4 rounded-vesper-half object-cover"
                    />
                  ) : (
                    <Document />
                  )
                }
              >
                <span className="flex items-center gap-vesper-1">
                  {file.name}
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setFiles((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="text-vesper-icon-tertiary hover:text-vesper-icon-primary"
                  >
                    <Close className="w-3.5 h-3.5" />
                  </button>
                </span>
              </Tag>
            ))}
          </div>
        )}
        {recorder.recording ? (
          <div className="flex items-center gap-vesper-4 min-h-12">
            <LevelMeter levels={recorder.levels} active />
            <Typography
              variant="label-sm-mono"
              className="tabular-nums text-vesper-text-secondary"
            >
              {formatElapsed(recorder.elapsedMs)}
            </Typography>
          </div>
        ) : (
          <textarea
            aria-label="Message"
            rows={2}
            value={text}
            disabled={disabled}
            placeholder={
              transcribing
                ? "Transcribing…"
                : modelName
                  ? `Message ${modelName}…`
                  : "Deploy a chat model to start chatting"
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
            className="w-full max-h-48 resize-none bg-transparent outline-none font-vesper-sans text-base text-vesper-text-primary placeholder:text-vesper-text-tertiary disabled:cursor-not-allowed"
          />
        )}
        <div className="flex items-center gap-vesper-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={
              allowImages
                ? "image/*,text/*,.md,.json,.csv,.yaml,.yml,.py,.ts,.js"
                : "text/*,.md,.json,.csv,.yaml,.yml,.py,.ts,.js"
            }
            className="hidden"
            onChange={(e) => {
              void attach(e.target.files);
              e.target.value = "";
            }}
          />
          <Tooltip
            content={
              allowImages ? "Attach images or text files" : "Attach text files"
            }
          >
            <IconButton
              type="button"
              size="sm"
              variant="ghost"
              icon={<Add />}
              aria-label="Attach files"
              disabled={disabled || streaming}
              onClick={() => fileRef.current?.click()}
            />
          </Tooltip>
          <div className="ml-auto flex items-center gap-vesper-2">
            <Tooltip
              content={
                sttModelId
                  ? recorder.recording
                    ? "Stop and transcribe"
                    : "Voice input"
                  : "Deploy a speech-to-text model to use voice input"
              }
            >
              <IconButton
                type="button"
                size="sm"
                variant={recorder.recording ? "danger" : "ghost"}
                icon={
                  transcribing ? (
                    <Spinner className="animate-spin" />
                  ) : (
                    <Microphone />
                  )
                }
                aria-label={
                  recorder.recording ? "Stop voice input" : "Voice input"
                }
                disabled={!sttModelId || disabled || streaming || transcribing}
                onClick={() =>
                  recorder.recording ? recorder.stop() : void recorder.start()
                }
              />
            </Tooltip>
            {streaming ? (
              <IconButton
                type="button"
                size="sm"
                variant="contrast"
                icon={<StopIcon />}
                aria-label="Stop generating"
                onClick={onStop}
              />
            ) : (
              <IconButton
                type="button"
                size="sm"
                variant="contrast"
                icon={<ArrowUp />}
                aria-label="Send message"
                disabled={!canSend}
                onClick={submit}
              />
            )}
          </div>
        </div>
      </div>
      {recorder.error && (
        <Typography
          variant="copy-xs"
          className="mt-vesper-2 text-vesper-text-error"
        >
          {recorder.error}
        </Typography>
      )}
    </div>
  );
}
