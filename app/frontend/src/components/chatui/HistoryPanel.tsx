// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useState } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PlusCircle, MessageSquare, Trash2, Edit2 } from "lucide-react";

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

  const handleEditStart = (id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  };

  const handleEditSave = (id: string) => {
    onEditConversationTitle(id, editTitle);
    setEditingId(null);
  };

  return (
    <div className="w-64 bg-white dark:bg-[#2A2A2A] h-full flex flex-col border-r border-gray-200 dark:border-[#7C68FA]/20">
      <div className="p-4 border-b border-gray-200 dark:border-[#7C68FA]/20">
        <Button
          onClick={onCreateNewConversation}
          className="w-full bg-[#7C68FA] hover:bg-[#7C68FA]/90 text-white"
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          New Chat
        </Button>
      </div>
      <ScrollArea className="flex-grow">
        {Array.isArray(conversations) &&
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`flex items-center justify-between p-2 hover:bg-gray-100 dark:hover:bg-[#3A3A3A] cursor-pointer ${
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
    </div>
  );
}
