// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PlusCircle, MessageSquare, Trash2, Edit2, Search } from "lucide-react";

interface HistoryPanelProps {
  conversations: { id: string; title: string }[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onEditConversationTitle: (id: string, newTitle: string) => void;
}

export function HistoryPanel({
  conversations = [],
  currentConversationId,
  onSelectConversation,
  onCreateNewConversation,
  onDeleteConversation,
  onEditConversationTitle,
}: HistoryPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const handleEditStart = (id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  };

  const handleEditSave = (id: string) => {
    onEditConversationTitle(id, editTitle);
    setEditingId(null);
  };

  const filteredConversations = conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full rounded-lg border border-slate-200 bg-white dark:bg-[#1C1C1C] dark:border-[#7C68FA]/20">
      <div className="flex-none p-4">
        <div className="flex items-center px-4 mb-6">
          <h2 className="text-lg font-medium">Chats</h2>
          <span className="ml-2 rounded-full bg-[#7C68FA] px-2 py-1 text-xs">
            {conversations.length}
          </span>
        </div>
        <div className="relative px-2">
          <Input
            type="text"
            className="w-full h-9 bg-slate-100 dark:bg-[#2A2A2A] border border-slate-200 dark:border-0 rounded-lg pl-9 text-slate-800 dark:text-zinc-200 placeholder:text-slate-400 dark:placeholder:text-zinc-400 focus:ring-2 focus:ring-[#7C68FA] transition-all"
            placeholder="Search Chats"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
        </div>
      </div>
      <ScrollArea className="flex-grow px-4">
        <div className="space-y-1">
          {filteredConversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-200 
                ${
                  conversation.id === currentConversationId
                    ? "bg-slate-200 dark:bg-[#3A3A3A]"
                    : "hover:bg-slate-100 dark:hover:bg-[#2A2A2A]"
                }`}
              onClick={() => onSelectConversation(conversation.id)}
            >
              <div className="flex items-center flex-grow min-w-0">
                <MessageSquare className="shrink-0 mr-2 h-4 w-4 text-zinc-400" />
                {editingId === conversation.id ? (
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleEditSave(conversation.id)}
                    onKeyPress={(e) =>
                      e.key === "Enter" && handleEditSave(conversation.id)
                    }
                    className="h-6 text-sm bg-[#2A2A2A] border-0 focus:ring-2 focus:ring-[#7C68FA]"
                    autoFocus
                  />
                ) : (
                  <span className="truncate text-slate-800 dark:text-slate-200">
                    {searchQuery &&
                    conversation.title
                      .toLowerCase()
                      .includes(searchQuery.toLowerCase())
                      ? conversation.title
                          .split(new RegExp(`(${searchQuery})`, "gi"))
                          .map((part, i) =>
                            part.toLowerCase() === searchQuery.toLowerCase() ? (
                              <span key={i} className="bg-[#7C68FA]/30">
                                {part}
                              </span>
                            ) : (
                              part
                            )
                          )
                      : conversation.title}
                  </span>
                )}
              </div>
              <div className="p-flex items-center shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:bg-slate-200 dark:hover:bg-[#3A3A3A] hover:text-[#7C68FA] transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditStart(conversation.id, conversation.title);
                  }}
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:bg-slate-200 dark:hover:bg-[#3A3A3A] hover:text-[#7C68FA] transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conversation.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="flex-none p-4">
        <Button
          onClick={onCreateNewConversation}
          className="w-full bg-[#7C68FA] dark:bg-[#7C68FA] hover:bg-[#7C68FA]/80 dark:hover:bg-[#7C68FA]/90 text-white transition-colors flex items-center justify-center gap-2 py-4 rounded-lg"
        >
          <PlusCircle className="h-4 w-4" />
          New Chat
        </Button>
      </div>
    </div>
  );
}
