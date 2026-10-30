// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useState } from "react";
import { Button } from "@tenstorrent/vesper/button";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { CircleAdd, Ellipses, Search } from "@tenstorrent/vesper/icons";
import { Menu } from "@tenstorrent/vesper/menu";
import { TextInput } from "@tenstorrent/vesper/text-input";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import type { ChatThread } from "../use-chat";

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

function ThreadButton({
  thread,
  active,
  onSelect,
  onDelete,
}: {
  thread: ChatThread;
  active: boolean;
  onSelect(): void;
  onDelete(): void;
}) {
  return (
    <li
      className={cn(
        "group flex items-center rounded-vesper-2",
        active
          ? "bg-vesper-tint-neutral-300"
          : "hover:bg-vesper-tint-neutral-200"
      )}
    >
      <button
        type="button"
        aria-current={active || undefined}
        onClick={onSelect}
        className="flex-1 min-w-0 h-10 px-vesper-2 text-left cursor-pointer"
      >
        <Typography
          as="span"
          variant="copy-sm"
          className={cn(
            "block truncate",
            active ? "text-vesper-text-primary" : "text-vesper-text-secondary"
          )}
        >
          {thread.title || "New chat"}
        </Typography>
      </button>
      <Menu
        as={IconButton}
        size="xs"
        variant="ghost"
        icon={<Ellipses />}
        aria-label={`Actions for ${thread.title || "chat"}`}
        className="mr-vesper-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        align="end"
        items={[{ text: "Delete chat", style: "danger", onSelect: onDelete }]}
      />
    </li>
  );
}

export function HistoryPanel({
  threads,
  currentId,
  onSelect,
  onDelete,
  onNewChat,
}: {
  threads: ChatThread[];
  currentId: string;
  onSelect(id: string): void;
  onDelete(id: string): void;
  onNewChat(): void;
}) {
  const [query, setQuery] = useState("");

  const { recents, older } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = threads.filter(
      (t) =>
        !needle ||
        t.title?.toLowerCase().includes(needle) ||
        t.messages?.some((m) => m.text?.toLowerCase().includes(needle))
    );
    const now = Date.now();
    // chats saved before timestamps were recorded count as older
    const isRecent = (t: ChatThread) =>
      (t.updatedAt ?? t.createdAt ?? 0) > now - RECENT_MS ||
      (t.messages ?? []).length === 0;
    return {
      recents: matches.filter(isRecent),
      older: matches.filter((t) => !isRecent(t)),
    };
  }, [threads, query]);

  const group = (title: string, list: ChatThread[]) =>
    list.length > 0 && (
      <div className="flex flex-col gap-vesper-2">
        <Typography
          as="h3"
          variant="label-xs"
          className="px-vesper-2 text-vesper-text-tertiary"
        >
          {title}
        </Typography>
        <ul className="flex flex-col gap-vesper-1">
          {list.map((thread) => (
            <ThreadButton
              key={thread.id}
              thread={thread}
              active={thread.id === currentId}
              onSelect={() => onSelect(thread.id)}
              onDelete={() => onDelete(thread.id)}
            />
          ))}
        </ul>
      </div>
    );

  return (
    <aside
      aria-label="Chat history"
      className="w-66 shrink-0 h-full flex flex-col gap-vesper-6 p-vesper-4 border-r border-vesper-border-tertiary bg-vesper-background-primary text-left"
    >
      <TextInput
        size="sm"
        aria-label="Search chats"
        placeholder="Search"
        iconLeft={<Search />}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-vesper-6">
        {group("Recents", recents)}
        {group("Older", older)}
        {recents.length === 0 && older.length === 0 && (
          <Typography
            variant="copy-sm"
            className="px-vesper-2 text-vesper-text-tertiary"
          >
            No chats match “{query}”.
          </Typography>
        )}
      </div>
      <Button
        type="button"
        size="md"
        variant="subtle"
        className="w-full"
        iconLeft={<CircleAdd />}
        onClick={onNewChat}
      >
        New chat
      </Button>
    </aside>
  );
}
