// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Gear, Microphone, Spinner } from "@tenstorrent/vesper/icons";
import { Select } from "@tenstorrent/vesper/select";
import { Switch } from "@tenstorrent/vesper/switch";
import { TextArea } from "@tenstorrent/vesper/text-area";
import { TextButton } from "@tenstorrent/vesper/text-button";
import { addToast } from "@tenstorrent/vesper/toast";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { Typography } from "@tenstorrent/vesper/typography";
import { runTTSInference } from "@/src/api/modelsDeployedApis";
import { runInference } from "@/src/components/chatui/runInference";
import type { ChatMessage, RagDataSource } from "@/src/components/chatui/types";
import { sendAudioRecording } from "@/src/components/voiceAgent/lib/apiClient";
import { cleanSpeechText } from "@/src/components/voiceAgent/lib/cleanSpeech";
import {
  loadVoiceSystemPrompt,
  renderVoiceSystemPrompt,
  saveVoiceSystemPrompt,
  VOICE_PROMPT_GROUNDING_CLAUSE,
  VOICE_PROMPT_PRESETS,
  VOICE_PROMPT_SAFETY_SUFFIX,
} from "@/src/components/voiceAgent/lib/prompts";
import { useAgentAvailability } from "@/src/hooks/useAgentAvailability";
import { cn } from "@/src/lib/utils";
import { getErrorMessage } from "@/src/utils/errors";
import { ControlledSheet } from "@/src/vesper/components/controlled-modal";
import { KnowledgeBasePicker } from "@/src/vesper/components/knowledge-base-picker";
import { LevelMeter } from "@/src/vesper/components/level-meter";
import { ModelLogo } from "@/src/vesper/components/model-logo";
import { ModelPicker } from "@/src/vesper/components/model-picker";
import {
  formatElapsed,
  useAudioRecorder,
} from "@/src/vesper/hooks/use-audio-recorder";
import { useHealthyModels } from "@/src/vesper/hooks/use-healthy-models";
import { Markdown } from "../chat/components/markdown";

type Stage = "idle" | "recording" | "transcribing" | "thinking" | "speaking";

interface Turn {
  id: string;
  sender: "user" | "assistant";
  text: string;
  /** Latencies of the turn, shown under assistant replies */
  metrics?: { stt?: number; llm?: number; tts?: number };
}

const STAGE_CAPTION: Record<Stage, string> = {
  idle: "Click to start talking",
  recording: "Click to stop recording",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  speaking: "Speaking… click to interrupt",
};

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}

export default function VoiceAgentPage() {
  const stt = useHealthyModels("speech_recognition");
  const llm = useHealthyModels(["chat", "vlm"]);
  const tts = useHealthyModels("tts");
  const [ragDatasource, setRagDatasource] = useState<
    RagDataSource | undefined
  >();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [stage, setStage] = useState<Stage>("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(loadVoiceSystemPrompt);
  const [searchAgent, setSearchAgent] = useState(false);
  const { isAgentAvailable } = useAgentAvailability(llm.selected?.id ?? null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  const ready = !!stt.selected && !!llm.selected;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    []
  );

  const updateTurn = (id: string, patch: Partial<Turn>) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const respond = useCallback(
    async (blob: Blob) => {
      if (!stt.selected || !llm.selected) return;
      setStage("transcribing");
      const sttStart = performance.now();
      let text = "";
      try {
        const data = await sendAudioRecording(blob, {
          modelID: stt.selected.id,
        });
        text = (data?.text ?? "").trim();
      } catch (err) {
        addToast({
          variant: "danger",
          content: `Couldn't transcribe: ${getErrorMessage(err)}`,
        });
        setStage("idle");
        return;
      }
      const sttMs = Math.round(performance.now() - sttStart);
      if (!text) {
        addToast({
          variant: "warning",
          content: "No speech was detected. Try again.",
          timeout: 4000,
        });
        setStage("idle");
        return;
      }

      const history: ChatMessage[] = turnsRef.current
        .filter((t) => t.text)
        .map((t) => ({ id: t.id, sender: t.sender, text: t.text }));
      history.push({ id: uuidv4(), sender: "user", text });
      const replyId = uuidv4();
      setTurns((prev) => [
        ...prev,
        { id: uuidv4(), sender: "user", text },
        { id: replyId, sender: "assistant", text: "" },
      ]);
      setStage("thinking");

      // runInference streams by calling back with the updated history
      const localHistory = [...history];
      const setHistory: Dispatch<SetStateAction<ChatMessage[]>> = (update) => {
        if (typeof update !== "function") return;
        const next = update(localHistory);
        localHistory.splice(0, localHistory.length, ...next);
        const last = next[next.length - 1];
        if (last?.sender === "assistant")
          updateTurn(replyId, { text: last.text });
      };

      const llmStart = performance.now();
      try {
        const grounding =
          ragDatasource || searchAgent
            ? `\n${VOICE_PROMPT_GROUNDING_CLAUSE}`
            : "";
        await runInference(
          {
            deploy_id: llm.selected.id,
            text,
            max_tokens: 512,
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            chat_template_kwargs: { enable_thinking: false },
          },
          ragDatasource,
          localHistory,
          setHistory,
          () => undefined,
          searchAgent && isAgentAvailable,
          0,
          undefined,
          `${renderVoiceSystemPrompt(systemPrompt, {
            userName: null,
            modelName: llm.selected.modelName,
          })}${grounding}\n${VOICE_PROMPT_SAFETY_SUFFIX}`,
          null,
          null
        );
      } catch (err) {
        updateTurn(replyId, {
          text: `Couldn't get a reply: ${getErrorMessage(err)}`,
        });
        setStage("idle");
        return;
      }
      const llmMs = Math.round(performance.now() - llmStart);
      const reply =
        localHistory.findLast((m) => m.sender === "assistant")?.text ?? "";
      updateTurn(replyId, { metrics: { stt: sttMs, llm: llmMs } });

      const spoken = cleanSpeechText(reply);
      if (!spoken || !tts.selected) {
        setStage("idle");
        return;
      }
      setStage("speaking");
      const ttsStart = performance.now();
      try {
        const audioBlob = await runTTSInference(tts.selected.id, spoken);
        updateTurn(replyId, {
          metrics: {
            stt: sttMs,
            llm: llmMs,
            tts: Math.round(performance.now() - ttsStart),
          },
        });
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = URL.createObjectURL(audioBlob);
        audioRef.current ??= new Audio();
        const audio = audioRef.current;
        audio.src = audioUrlRef.current;
        audio.onended = () => setStage("idle");
        audio.onerror = () => setStage("idle");
        await audio.play();
      } catch (err) {
        addToast({
          variant: "warning",
          content: `Couldn't speak the reply: ${getErrorMessage(err)}`,
          timeout: 5000,
        });
        setStage("idle");
      }
    },
    [
      stt.selected,
      llm.selected,
      tts.selected,
      ragDatasource,
      searchAgent,
      isAgentAvailable,
      systemPrompt,
    ]
  );

  const recorder = useAudioRecorder({
    onRecorded: (blob) => void respond(blob),
  });
  const currentStage: Stage = recorder.recording ? "recording" : stage;

  const handleMainButton = () => {
    if (recorder.recording) return recorder.stop();
    if (stage === "speaking") {
      audioRef.current?.pause();
      setStage("idle");
      return;
    }
    if (stage === "idle") void recorder.start();
  };

  return (
    <div className="h-full flex flex-col text-left">
      <div className="h-16 shrink-0 flex items-center gap-vesper-4 px-vesper-6 border-b border-vesper-border-tertiary bg-vesper-background-primary">
        <div className="flex items-center gap-vesper-3 min-w-0">
          {llm.selected && (
            <ModelLogo
              modelName={llm.selected.modelName}
              hfModelId={llm.selected.hfModelId}
            />
          )}
          <Typography
            variant="label-md"
            className="truncate text-vesper-text-primary"
          >
            {llm.selected?.modelName ??
              (llm.isLoading ? "Loading models…" : "No LLM is ready")}
          </Typography>
        </div>
        <div className="ml-auto flex items-center gap-vesper-3">
          <KnowledgeBasePicker
            className="w-56"
            value={ragDatasource}
            onChange={setRagDatasource}
          />
          <Tooltip content="Voice agent settings">
            <IconButton
              type="button"
              size="sm"
              variant="ghost"
              icon={<Gear />}
              aria-label="Voice agent settings"
              onClick={() => setSettingsOpen(true)}
            />
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="w-full max-w-2xl mx-auto flex flex-col gap-vesper-8 px-vesper-6 py-vesper-8">
          {!ready && !stt.isLoading && !llm.isLoading && (
            <Admonition variant="warning" subtle>
              The voice agent needs a speech-to-text model and an LLM (plus a
              text-to-speech model to talk back). Deploy the Voice Agent
              solution from the Deployments page.
            </Admonition>
          )}
          {turns.length === 0 && ready && (
            <Typography
              variant="copy-md"
              className="text-center text-vesper-text-tertiary py-vesper-16"
            >
              Ask anything. Your speech is transcribed, answered by{" "}
              {llm.selected?.modelName}
              {tts.selected ? ", and read back to you." : "."}
            </Typography>
          )}
          {turns.map((turn) =>
            turn.sender === "user" ? (
              <Typography
                key={turn.id}
                variant="copy-md"
                className="self-end max-w-[85%] px-vesper-4 py-vesper-3 rounded-vesper-2 bg-vesper-tint-neutral-300 text-vesper-text-primary"
              >
                {turn.text}
              </Typography>
            ) : (
              <div key={turn.id} className="flex flex-col gap-vesper-2">
                {turn.text ? (
                  <Markdown text={turn.text} />
                ) : (
                  <Spinner className="w-4 h-4 animate-spin text-vesper-icon-tertiary" />
                )}
                {turn.metrics && (
                  <Typography
                    variant="label-xs-mono"
                    className="text-vesper-text-tertiary"
                  >
                    {[
                      turn.metrics.stt !== undefined &&
                        `STT ${turn.metrics.stt} ms`,
                      turn.metrics.llm !== undefined &&
                        `LLM ${turn.metrics.llm} ms`,
                      turn.metrics.tts !== undefined &&
                        `TTS ${turn.metrics.tts} ms`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                )}
              </div>
            )
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="shrink-0 flex flex-col items-center gap-vesper-4 px-vesper-6 pb-vesper-6 pt-vesper-2">
        <LevelMeter levels={recorder.levels} active={recorder.recording} />
        <IconButton
          type="button"
          size="lg"
          variant={currentStage === "recording" ? "danger" : "primary"}
          className={cn(
            "w-14 h-14 rounded-full",
            currentStage === "recording" && "shadow-vesper-300"
          )}
          icon={
            currentStage === "transcribing" || currentStage === "thinking" ? (
              <Spinner className="animate-spin" />
            ) : currentStage === "recording" || currentStage === "speaking" ? (
              <StopIcon />
            ) : (
              <Microphone />
            )
          }
          aria-label={STAGE_CAPTION[currentStage]}
          disabled={
            !ready ||
            currentStage === "transcribing" ||
            currentStage === "thinking"
          }
          onClick={handleMainButton}
        />
        <Typography variant="copy-sm" className="text-vesper-text-secondary">
          {currentStage === "recording"
            ? `${STAGE_CAPTION.recording} · ${formatElapsed(recorder.elapsedMs)}`
            : STAGE_CAPTION[currentStage]}
        </Typography>
        {turns.length > 0 && currentStage === "idle" && (
          <TextButton
            type="button"
            size="sm"
            variant="subtle"
            onClick={() => setTurns([])}
          >
            New conversation
          </TextButton>
        )}
        {recorder.error && (
          <Typography variant="copy-xs" className="text-vesper-text-error">
            {recorder.error}
          </Typography>
        )}
      </div>

      <ControlledSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Voice agent settings"
        description="Models used in the pipeline, and how the agent responds."
        buttons={[{ children: "Done", onClick: () => setSettingsOpen(false) }]}
      >
        <div className="flex flex-col gap-vesper-6 py-vesper-2">
          <ModelPicker
            label="Speech-to-text"
            models={stt.models}
            isLoading={stt.isLoading}
            value={stt.selected?.id ?? null}
            onChange={stt.setSelectedId}
            emptyText="No speech-to-text model is ready."
          />
          <ModelPicker
            label="LLM"
            models={llm.models}
            isLoading={llm.isLoading}
            value={llm.selected?.id ?? null}
            onChange={llm.setSelectedId}
            emptyText="No LLM is ready."
          />
          <ModelPicker
            label="Text-to-speech"
            models={tts.models}
            isLoading={tts.isLoading}
            value={tts.selected?.id ?? null}
            onChange={tts.setSelectedId}
            emptyText="No text-to-speech model is ready, so replies won't be spoken."
          />
          <label className="flex flex-col gap-vesper-2">
            <Typography
              as="span"
              variant="label-sm"
              className="text-vesper-text-secondary"
            >
              Persona
            </Typography>
            <Select
              aria-label="Persona preset"
              placeholder="Custom"
              options={VOICE_PROMPT_PRESETS.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
              value={
                VOICE_PROMPT_PRESETS.find((p) => p.prompt === systemPrompt)
                  ?.id ?? null
              }
              onValueChange={(id) => {
                const preset = VOICE_PROMPT_PRESETS.find((p) => p.id === id);
                if (preset) {
                  setSystemPrompt(preset.prompt);
                  saveVoiceSystemPrompt(preset.prompt);
                }
              }}
            />
          </label>
          <label className="flex flex-col gap-vesper-2">
            <Typography
              as="span"
              variant="label-sm"
              className="text-vesper-text-secondary"
            >
              System prompt
            </Typography>
            <TextArea
              aria-label="System prompt"
              height={160}
              value={systemPrompt}
              onChange={(e) => {
                setSystemPrompt(e.target.value);
                saveVoiceSystemPrompt(e.target.value);
              }}
            />
            <Typography variant="copy-xs" className="text-vesper-text-tertiary">
              Use {"{model_name}"} and {"{user_name}"} to fill in details per
              turn.
            </Typography>
          </label>
          {isAgentAvailable && (
            <Switch
              label="Web search agent"
              checked={searchAgent}
              onChange={(e) => setSearchAgent(e.target.checked)}
            />
          )}
        </div>
      </ControlledSheet>
    </div>
  );
}
