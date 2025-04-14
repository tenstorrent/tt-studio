// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState, useEffect, useRef } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { PlusCircle, MessageSquare, Trash2, Edit2, Search } from "lucide-react";
import { customToast } from "../CustomToaster";

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
  const chatListRef = useRef<HTMLDivElement>(null);
  const activeChatRef = useRef<HTMLDivElement>(null);

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

  // Scroll active chat into view when it changes
  useEffect(() => {
    if (activeChatRef.current) {
      activeChatRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [currentConversationId]);

  const handleEditStart = (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(title);
  };

  const handleEditSave = (id: string) => {
    if (editTitle.trim()) {
      onEditConversationTitle(id, editTitle);
      customToast.success(`Renamed to "${editTitle}"`);
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

  const handleChatSelection = (id: string, title: string) => {
    onSelectConversation(id);
    customToast.info(`Switched to "${title}"`);
  };

  const handleDeleteChat = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    onDeleteConversation(id);
    customToast.destructive(`Deleted "${title}"`);
  };

  const handleCreateNewChat = () => {
    onCreateNewConversation();
    customToast.success("Created new chat");
  };

  const highlightSearchText = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark
          key={i}
          className="bg-yellow-200/80 dark:bg-yellow-500/50 rounded-sm px-0.5"
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="flex flex-col h-full rounded-lg border border-slate-200 bg-white dark:bg-[#1C1C1C] dark:border-[#7C68FA]/20">
      {/* Fixed Header */}
      <div className="flex-none p-4 border-b border-slate-200 dark:border-[#7C68FA]/10">
        <div className="flex items-center px-4 mb-6">
          <h2 className="text-lg font-medium tracking-tight">Chats</h2>
          <span className="ml-2 rounded-full bg-[#7C68FA] px-2 py-0.5 text-xs font-medium text-white">
            {uniqueConversations.length}
          </span>
        </div>
        <div className="relative px-2">
          <Input
            type="text"
            className="w-full h-9 bg-slate-100 dark:bg-[#2A2A2A] border border-slate-200 dark:border-0 rounded-lg pl-9 text-slate-800 dark:text-zinc-200 placeholder:text-slate-400 dark:placeholder:text-zinc-400 focus:ring-2 focus:ring-[#7C68FA] transition-all font-normal"
            placeholder="Search Chats"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
        </div>
      </div>

      {/* Scrollable Chat List */}
      <div className="flex-1 overflow-y-auto" ref={chatListRef}>
        <div className="p-4 space-y-0 divide-y divide-slate-200/20 dark:divide-[#7C68FA]/10">
          {filteredConversations.map((conversation) => (
            <div
              key={conversation.id}
              ref={
                conversation.id === currentConversationId ? activeChatRef : null
              }
              className={`group flex items-center justify-between w-full rounded-lg px-3 py-3 text-sm transition-all duration-200 cursor-pointer hover:shadow-sm ${
                conversation.id === currentConversationId
                  ? "bg-[#7C68FA] text-white shadow-md shadow-[#7C68FA]/20"
                  : "hover:bg-slate-100 dark:hover:bg-[#2A2A2A] text-slate-700 dark:text-slate-200 hover:translate-x-0.5 hover:scale-[1.01]"
              }`}
              onClick={() =>
                handleChatSelection(conversation.id, conversation.title)
              }
            >
              <div className="flex items-center min-w-0 flex-1">
                <MessageSquare
                  className={`h-4 w-4 shrink-0 mr-2 transition-all duration-200 ${
                    conversation.id === currentConversationId
                      ? ""
                      : "group-hover:scale-110 group-hover:text-[#7C68FA] group-hover:rotate-[-8deg]"
                  }`}
                />
                {editingId === conversation.id ? (
                  <Input
                    type="text"
                    className="w-full bg-transparent border-none focus:outline-none focus:ring-0 p-0 h-auto text-inherit"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleEditSave(conversation.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEditSave(conversation.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <span
                    className="truncate flex-1"
                    onClick={() => onSelectConversation(conversation.id)}
                  >
                    {highlightSearchText(conversation.title, searchQuery)}
                  </span>
                )}
              </div>
              <div
                className={`flex items-center gap-1 ml-2 transition-all duration-200 ${
                  conversation.id === currentConversationId
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0"
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(conversation.id);
                    setEditTitle(conversation.title);
                  }}
                  className={`p-1 rounded-md transition-all duration-200 hover:scale-110 ${
                    conversation.id === currentConversationId
                      ? "text-white/80 hover:text-white hover:bg-white/20"
                      : "text-[#7C68FA]/70 hover:text-[#7C68FA] hover:bg-[#7C68FA]/10 dark:text-[#7C68FA]/60 dark:hover:text-[#7C68FA]"
                  }`}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) =>
                    handleDeleteChat(e, conversation.id, conversation.title)
                  }
                  className={`p-1 rounded-md transition-all duration-200 hover:scale-110 ${
                    conversation.id === currentConversationId
                      ? "text-white/80 hover:text-red-200 hover:bg-red-500/30"
                      : "text-red-400/60 hover:text-red-500 hover:bg-red-500/10 dark:text-red-400/50 dark:hover:text-red-400"
                  }`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fixed Footer */}
      <div className="flex-none p-4 border-t border-slate-200 dark:border-[#7C68FA]/10">
        <Button
          onClick={handleCreateNewChat}
          className="w-full bg-slate-100 dark:bg-[#2A2A2A] hover:bg-slate-200 dark:hover:bg-[#3A3A3A] text-slate-700 dark:text-slate-200 transition-all duration-200 hover:shadow-md hover:scale-[1.02] active:scale-100"
        >
          <PlusCircle className="mr-2 h-4 w-4 transition-transform duration-200 group-hover:scale-110" />
          New Chat
        </Button>
      </div>
    </div>
  );
}
