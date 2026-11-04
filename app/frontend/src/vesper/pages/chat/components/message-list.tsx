// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef } from "react";
import { Accordion } from "@tenstorrent/vesper/accordion";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Copy, Document, Reset } from "@tenstorrent/vesper/icons";
import { Tag } from "@tenstorrent/vesper/tag";
import { addToast } from "@tenstorrent/vesper/toast";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { Typography } from "@tenstorrent/vesper/typography";
import type {
  ChatMessage,
  InferenceStats,
} from "@/src/components/chatui/types";
import { copyToClipboard } from "@/src/utils/clipboard";
import { MatrixLoader } from "@/src/vesper/components/matrix-loader";
import { splitThinking } from "../utils";
import { Markdown } from "./markdown";

function formatStats(stats: InferenceStats) {
  const parts: string[] = [];
  const ttftMs =
    stats.client_ttft_ms ??
    (stats.user_ttft_s !== undefined ? stats.user_ttft_s * 1000 : undefined);
  if (ttftMs !== undefined) parts.push(`TTFT ${Math.round(ttftMs)} ms`);
  const tps =
    stats.tps ??
    stats.tokensPerSecond ??
    (stats.user_tpot ? 1 / stats.user_tpot : undefined);
  if (tps) parts.push(`${tps.toFixed(1)} tok/s`);
  const tokens = stats.tokens_decoded ?? stats.completionTokens;
  if (tokens) parts.push(`${tokens} tokens`);
  return parts.join(" · ");
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-vesper-2">
      {(message.files ?? []).length > 0 && (
        <div className="flex flex-wrap justify-end gap-vesper-2">
          {(message.files ?? []).map((file, i) =>
            file.type === "image_url" && file.image_url?.url ? (
              <img
                key={i}
                src={file.image_url.url}
                alt={file.name}
                className="max-h-40 rounded-vesper-2 border border-vesper-border-secondary"
              />
            ) : (
              <Tag key={i} size="md" icon={<Document />}>
                {file.name}
              </Tag>
            )
          )}
        </div>
      )}
      {message.text && (
        <Typography
          variant="copy-md"
          className="max-w-[min(36rem,85%)] px-vesper-4 py-vesper-3 rounded-vesper-2 bg-vesper-background-accent-base text-vesper-text-primary whitespace-pre-wrap break-words"
        >
          {message.text}
        </Typography>
      )}
      {message.ragDatasource && (
        <Typography variant="label-xs" className="text-vesper-text-tertiary">
          Knowledge base: {message.ragDatasource.name}
        </Typography>
      )}
    </div>
  );
}

function AssistantMessage({
  message,
  streaming,
  isLast,
  onRegenerate,
}: {
  message: ChatMessage;
  streaming: boolean;
  isLast: boolean;
  onRegenerate(): void;
}) {
  const { thinking, answer, thinkingOpen } = splitThinking(message.text ?? "");
  const stats = message.inferenceStats
    ? formatStats(message.inferenceStats)
    : "";
  const live = streaming && isLast;

  return (
    <div className="flex flex-col gap-vesper-3">
      {thinking && (
        <Accordion
          title={thinkingOpen && live ? "Thinking…" : "Thoughts"}
          defaultOpen={false}
          className="text-vesper-text-secondary"
        >
          <Typography
            variant="copy-sm"
            className="whitespace-pre-wrap text-vesper-text-secondary"
          >
            {thinking}
          </Typography>
        </Accordion>
      )}
      {answer ? (
        <Markdown text={answer} />
      ) : (
        live && <MatrixLoader className="mt-vesper-1" />
      )}
      {(message.sources ?? []).length > 0 && (
        <div className="flex flex-wrap gap-vesper-2">
          {message.sources!.map((source) => (
            <Tag
              key={source.url}
              as="a"
              href={source.url}
              target="_blank"
              rel="noreferrer"
              size="sm"
            >
              {source.title || source.url}
            </Tag>
          ))}
        </div>
      )}
      {!live && answer && (
        <div className="flex items-center gap-vesper-1 -ml-vesper-1">
          <Tooltip content="Copy">
            <IconButton
              type="button"
              size="xs"
              variant="ghost"
              icon={<Copy />}
              aria-label="Copy reply"
              onClick={async () => {
                const error = await copyToClipboard(answer);
                addToast(
                  error
                    ? { variant: "danger", content: `Couldn't copy: ${error}` }
                    : { variant: "success", content: "Copied", timeout: 2000 }
                );
              }}
            />
          </Tooltip>
          {isLast && (
            <Tooltip content="Regenerate">
              <IconButton
                type="button"
                size="xs"
                variant="ghost"
                icon={<Reset />}
                aria-label="Regenerate reply"
                onClick={onRegenerate}
              />
            </Tooltip>
          )}
          {stats && (
            <Typography
              variant="label-xs-mono"
              className="ml-vesper-2 text-vesper-text-tertiary"
            >
              {stats}
            </Typography>
          )}
          {message.isStopped && (
            <Typography
              variant="label-xs"
              className="ml-vesper-2 text-vesper-text-tertiary"
            >
              Stopped
            </Typography>
          )}
        </div>
      )}
    </div>
  );
}

export function MessageList({
  messages,
  streaming,
  onRegenerate,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  onRegenerate(): void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // follow the stream unless the user has scrolled up to read
  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const lastAssistant = messages.length - 1;
  const waitingForReply =
    streaming && messages[messages.length - 1]?.sender === "user";

  return (
    <div
      ref={containerRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="flex-1 min-h-0 overflow-auto"
    >
      <div className="w-full max-w-3xl mx-auto flex flex-col gap-vesper-10 px-vesper-6 py-vesper-8">
        {messages.map((message, i) =>
          message.sender === "user" ? (
            <UserMessage key={message.id ?? i} message={message} />
          ) : (
            <AssistantMessage
              key={message.id ?? i}
              message={message}
              streaming={streaming}
              isLast={i === lastAssistant}
              onRegenerate={onRegenerate}
            />
          )
        )}
        {waitingForReply && <MatrixLoader />}
        <div ref={endRef} />
      </div>
    </div>
  );
}
