// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { PlusCircle, MessageSquare, Trash2, Edit2, Search } from "lucide-react";

interface HistoryPanelProps {
  conversations: { id: string; title: string }[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onEditConversationTitle: (id: string, newTitle: string) => void;
  isLoading?: boolean;
}

export function HistoryPanel({
  conversations = [],
  currentConversationId,
  onSelectConversation,
  onCreateNewConversation,
  onDeleteConversation,
  onEditConversationTitle,
  isLoading: externalIsLoading = false,
}: HistoryPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [internalIsLoading, setInternalIsLoading] = useState(true);
  
  // Combine external and internal loading states
  const isLoading = externalIsLoading || internalIsLoading;

  // Check if device is mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);
  
  // Show initial loading effect when component mounts
  useEffect(() => {
    // Clear internal loading after a short delay to show the animation
    const timer = setTimeout(() => setInternalIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const handleEditStart = (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(title);
  };

  const handleEditSave = (id: string) => {
    if (editTitle.trim()) {
      onEditConversationTitle(id, editTitle);
    }
    setEditingId(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter") {
      handleEditSave(id);
    } else if (e.key === "Escape") {
      setEditingId(null);
    }
  };

  // Ensure conversations is always an array and doesn't have duplicates
  const safeConversations = Array.isArray(conversations) ? conversations : [];

  // Create a map to deduplicate conversations by ID
  const conversationMap = new Map();
  safeConversations.forEach((conv) => {
    if (!conversationMap.has(conv.id)) {
      conversationMap.set(conv.id, conv);
    }
  });

  // Convert back to array and filter by search query
  const uniqueConversations = Array.from(conversationMap.values());
  const filteredConversations = uniqueConversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Show skeleton if loading, regardless of mobile state
  if (isLoading) {
    return (
      <div className="flex flex-col h-full rounded-lg border border-slate-200 bg-white dark:bg-[#1C1C1C] dark:border-[#7C68FA]/20 p-4 space-y-4">
        <div className="flex-none space-y-4">
          <Skeleton className="h-10 w-3/4" /> {/* Chats header */}
          <Skeleton className="h-9 w-full" /> {/* Search bar */}
          <Skeleton className="h-10 w-full" /> {/* New chat button */}
        </div>
        <div className="flex-grow space-y-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" /> /* Chat items */
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full rounded-lg border border-slate-200 bg-white dark:bg-[#1C1C1C] dark:border-[#7C68FA]/20">
      <div className="flex-none p-4">
        <div className="flex items-center px-4 mb-6">
          <h2 className="text-lg font-medium">Chats</h2>
          <span className="ml-2 rounded-full bg-[#7C68FA] px-2 py-1 text-xs">
            {uniqueConversations.length}
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
        <div className="space-y-2">
          {filteredConversations.map((conversation) => (
            <div key={`conv-${conversation.id}`} className="relative group">
              {/* Main conversation item */}
              <div
                className={`flex items-center justify-between p-2 ${isMobile ? "p-3" : "p-2"} rounded-lg cursor-pointer transition-all duration-200 
                  ${
                    conversation.id === currentConversationId
                      ? "bg-slate-200 dark:bg-[#3A3A3A]"
                      : "hover:bg-slate-100 dark:hover:bg-[#2A2A2A]"
                  }`}
                onClick={() => onSelectConversation(conversation.id)}
              >
                <div className="flex items-center flex-grow min-w-0 pr-16">
                  {" "}
                  {/* Added padding right for buttons */}
                  <MessageSquare
                    className={`shrink-0 mr-2 ${isMobile ? "h-5 w-5" : "h-4 w-4"} text-zinc-400`}
                  />
                  {editingId === conversation.id ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => handleEditSave(conversation.id)}
                      onKeyDown={(e) => handleEditKeyDown(e, conversation.id)}
                      className={`${isMobile ? "h-8" : "h-6"} text-sm bg-transparent dark:bg-[#2A2A2A] border-0 focus:ring-2 focus:ring-[#7C68FA]`}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className={`truncate text-slate-800 dark:text-slate-200 ${isMobile ? "text-base" : "text-sm"} max-w-[calc(100%-40px)]`}
                    >
                      {searchQuery &&
                      conversation.title
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase())
                        ? conversation.title
                            .split(new RegExp(`(${searchQuery})`, "gi"))
                            .map((part: string, partIndex: number) =>
                              part.toLowerCase() ===
                              searchQuery.toLowerCase() ? (
                                <span
                                  key={`highlight-${conversation.id}-${partIndex}`}
                                  className="bg-[#7C68FA]/30"
                                >
                                  {part}
                                </span>
                              ) : (
                                <span
                                  key={`normal-${conversation.id}-${partIndex}`}
                                >
                                  {part}
                                </span>
                              )
                            )
                        : conversation.title}
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons positioned absolutely */}
              <div
                className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10 
                  ${isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"} 
                  transition-opacity`}
              >
                <button
                  onClick={(e) =>
                    handleEditStart(conversation.id, conversation.title, e)
                  }
                  className="p-2 rounded-full bg-[#7C68FA]/20 flex items-center justify-center"
                >
                  <Edit2 className="h-4 w-4 text-[#7C68FA] dark:text-[#7C68FA]" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conversation.id);
                  }}
                  className="p-2 rounded-full bg-red-500/10 flex items-center justify-center"
                >
                  <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="flex-none p-4">
        <Button
          onClick={onCreateNewConversation}
          className={`w-full bg-[#7C68FA] dark:bg-[#7C68FA] hover:bg-[#7C68FA]/80 dark:hover:bg-[#7C68FA]/90 text-white transition-colors flex items-center justify-center gap-2 ${isMobile ? "py-5 text-base" : "py-4"} rounded-lg`}
        >
          <PlusCircle className={`${isMobile ? "h-5 w-5" : "h-4 w-4"}`} />
          New Chat
        </Button>
      </div>
    </div>
  );
}
