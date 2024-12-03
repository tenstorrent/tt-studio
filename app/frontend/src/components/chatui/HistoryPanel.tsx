// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

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
    conversation.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="max-w-xl rounded-lg border border-slate-300 bg-white dark:bg-[#2A2A2A] py-8 dark:border-[#7C68FA]/20">
      <div className="flex items-start px-5">
        <h2 className="text-lg font-medium text-slate-800 dark:text-slate-200">
          Chats
        </h2>
        <span className="ml-2 rounded-full bg-[#7C68FA] px-2 py-1 text-xs text-slate-200">
          {conversations.length}
        </span>
      </div>
      <div className="mx-2 mt-8">
        <div className="relative">
          <Input
            type="text"
            className="w-full rounded-lg border border-slate-300 bg-slate-50 p-3 pr-10 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#7C68FA] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            placeholder="Search chats"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Button
            type="button"
            className="absolute bottom-2 right-2.5 rounded-lg p-2 text-sm text-slate-500 hover:text-[#7C68FA] focus:outline-none sm:text-base"
          >
            <Search className="h-5 w-5" />
            <span className="sr-only">Search chats</span>
          </Button>
        </div>
      </div>
      <ScrollArea className="my-4 h-80 px-2">
        {filteredConversations.map((conversation) => (
          <div
            key={conversation.id}
            className={`flex items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-[#3A3A3A] cursor-pointer rounded-lg mb-2 ${
              conversation.id === currentConversationId
                ? "bg-gray-200 dark:bg-[#3A3A3A]"
                : ""
            }`}
            onClick={() => onSelectConversation(conversation.id)}
          >
            <div className="flex items-center flex-grow mr-2">
              <MessageSquare className="mr-2 h-4 w-4 text-gray-600 dark:text-gray-300" />
              {editingId === conversation.id ? (
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => handleEditSave(conversation.id)}
                  onKeyPress={(e) =>
                    e.key === "Enter" && handleEditSave(conversation.id)
                  }
                  className="h-6 text-sm"
                  autoFocus
                />
              ) : (
                <span className="truncate text-gray-800 dark:text-gray-200">
                  {conversation.title}
                </span>
              )}
            </div>
            <div className="flex">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditStart(conversation.id, conversation.title);
                }}
                className="h-6 w-6"
              >
                <Edit2 className="h-3 w-3 text-gray-600 dark:text-gray-300" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteConversation(conversation.id);
                }}
                className="h-6 w-6"
              >
                <Trash2 className="h-3 w-3 text-gray-600 dark:text-gray-300" />
              </Button>
            </div>
          </div>
        ))}
      </ScrollArea>
      <div className="mx-2 mt-8">
        <Button
          onClick={onCreateNewConversation}
          className="flex w-full justify-center items-center rounded-lg bg-[#7C68FA] p-4 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7C68FA]/90 focus:outline-none"
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          New Chat
        </Button>
      </div>
    </div>
  );
}
