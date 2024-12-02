// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import { PlusCircle, MessageSquare, Trash2 } from "lucide-react";

interface HistoryPanelProps {
  conversations: { id: string; title: string }[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

export function HistoryPanel({
  conversations = [],
  currentConversationId,
  onSelectConversation,
  onCreateNewConversation,
  onDeleteConversation,
}: HistoryPanelProps) {
  return (
    <div className="w-64 bg-gray-100 h-full flex flex-col">
      <div className="p-4">
        <Button onClick={onCreateNewConversation} className="w-full">
          <PlusCircle className="mr-2 h-4 w-4" />
          New Chat
        </Button>
      </div>
      <ScrollArea className="flex-grow">
        {Array.isArray(conversations) &&
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`flex items-center justify-between p-2 hover:bg-gray-200 cursor-pointer ${
                conversation.id === currentConversationId ? "bg-blue-100" : ""
              }`}
              onClick={() => onSelectConversation(conversation.id)}
            >
              <div className="flex items-center">
                <MessageSquare className="mr-2 h-4 w-4" />
                <span className="truncate">{conversation.title}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteConversation(conversation.id);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
      </ScrollArea>
    </div>
  );
}
