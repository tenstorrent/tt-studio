import { useState } from "react";
import { Search, Settings, Plus, MessageSquare, Moon, Sun } from "lucide-react";
import { Button } from "../ui/button";
import { useTheme } from "../../providers/ThemeProvider";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "../ui/sidebar";

interface Conversation {
  id: string;
  title: string;
  date: Date;
  transcriptions: {
    id: string;
    text: string;
    date: Date;
  }[];
}

interface SidebarProps {
  conversations: Conversation[];
  selectedConversation: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
}

export function AppSidebar({
  conversations,
  selectedConversation,
  onSelectConversation,
  onNewConversation,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { theme, setTheme } = useTheme();

  // Enhanced search to look through all transcription text in each conversation
  const filteredConversations = conversations.filter((conversation) => {
    if (!searchQuery) return true; // If no search query, show all conversations

    // Search in conversation title
    const titleMatch = conversation.title
      .toLowerCase()
      .includes(searchQuery.toLowerCase());

    // Search in all transcription text (safely)
    const transcriptionMatch = conversation.transcriptions.some(
      (transcription) =>
        transcription.text && // Check if text exists
        typeof transcription.text === "string" && // Check that it's a string
        transcription.text.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    return titleMatch || transcriptionMatch;
  });

  // Function to highlight matching text in a string
  const highlightMatch = (text: string, query: string) => {
    if (!query || !text) return text;

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) return text;

    const before = text.substring(0, index);
    const match = text.substring(index, index + query.length);
    const after = text.substring(index + query.length);

    return (
      <>
        {before}
        <span className="bg-yellow-500/30 dark:bg-yellow-500/20 text-foreground px-0.5 rounded-sm font-medium">
          {match}
        </span>
        {after}
      </>
    );
  };

  // Find matching transcription text to highlight in preview
  const getMatchingPreviewText = (conversation: Conversation) => {
    if (!searchQuery || !conversation.transcriptions.length) {
      return getPreviewText(conversation);
    }

    // Try to find a transcription that matches the search query
    const matchingTranscription = conversation.transcriptions.find(
      (t) =>
        t.text &&
        typeof t.text === "string" &&
        t.text.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    if (matchingTranscription && matchingTranscription.text) {
      const text = matchingTranscription.text;
      const index = text.toLowerCase().indexOf(searchQuery.toLowerCase());

      // Get context around the match
      const start = Math.max(0, index - 15);
      const end = Math.min(text.length, index + searchQuery.length + 15);

      const preview =
        (start > 0 ? "..." : "") +
        text.substring(start, index) +
        `[${text.substring(index, index + searchQuery.length)}]` +
        text.substring(index + searchQuery.length, end) +
        (end < text.length ? "..." : "");

      return preview;
    }

    return getPreviewText(conversation);
  };

  const formatDate = (date: Date) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return `Today at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    } else {
      return (
        date.toLocaleDateString([], { month: "short", day: "numeric" }) +
        ` at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      );
    }
  };

  // Standard function to get preview text from conversation
  const getPreviewText = (conversation: Conversation) => {
    if (!conversation.transcriptions.length) return "No messages yet";

    const lastTranscription =
      conversation.transcriptions[conversation.transcriptions.length - 1];

    // Safely handle the text
    if (!lastTranscription.text) return "Empty message";

    return (
      lastTranscription.text.substring(0, 40) +
      (lastTranscription.text.length > 40 ? "..." : "")
    );
  };

  // Update theme toggle function
  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="space-y-2">
        <div className="flex items-center justify-between px-3 sm:px-4 pt-4">
          <h2 className="text-lg sm:text-xl font-semibold">Conversations</h2>
        </div>

        <div className="px-3 sm:px-4 flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <SidebarInput
              placeholder="Search"
              className="pl-8 h-9 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button
            onClick={onNewConversation}
            variant="default"
            size="icon"
            className="h-9 w-9 flex-shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span className="sr-only">New Conversation</span>
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {searchQuery && (
          <div className="px-3 sm:px-4 py-2 text-xs text-muted-foreground">
            {filteredConversations.length === 0
              ? "No conversations found"
              : `Found in ${filteredConversations.length} conversation${filteredConversations.length === 1 ? "" : "s"}`}
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredConversations.length > 0 ? (
                filteredConversations.map((conversation) => (
                  <SidebarMenuItem key={conversation.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={selectedConversation === conversation.id}
                      className="flex flex-col items-start py-2 sm:py-3 px-3 sm:px-4 touch-manipulation"
                    >
                      <button
                        onClick={() => onSelectConversation(conversation.id)}
                      >
                        <div className="flex items-start w-full">
                          <MessageSquare className="h-4 w-4 mr-2 flex-shrink-0 mt-0.5" />
                          <div className="flex-1 overflow-hidden">
                            <div className="font-medium text-sm sm:text-base">
                              {highlightMatch(conversation.title, searchQuery)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              <span className="block">
                                {searchQuery &&
                                conversation.transcriptions.some(
                                  (t) =>
                                    t.text &&
                                    typeof t.text === "string" &&
                                    t.text
                                      .toLowerCase()
                                      .includes(searchQuery.toLowerCase()),
                                ) ? (
                                  <span>
                                    {getMatchingPreviewText(conversation)
                                      .split("[")
                                      .map((part, i) => {
                                        if (i === 0) return part;
                                        const closeBracketIndex =
                                          part.indexOf("]");
                                        if (closeBracketIndex === -1)
                                          return part;

                                        const matchText = part.substring(
                                          0,
                                          closeBracketIndex,
                                        );
                                        const restText = part.substring(
                                          closeBracketIndex + 1,
                                        );

                                        return (
                                          <span key={i}>
                                            <span className="bg-yellow-500/30 dark:bg-yellow-500/20 text-foreground px-0.5 rounded-sm font-medium">
                                              {matchText}
                                            </span>
                                            {restText}
                                          </span>
                                        );
                                      })}
                                  </span>
                                ) : (
                                  getPreviewText(conversation)
                                )}
                              </span>
                              <div className="flex justify-between items-center mt-1 flex-wrap gap-1">
                                <span className="text-xs bg-secondary px-1.5 py-0.5 rounded-sm">
                                  {conversation.transcriptions.length}{" "}
                                  {conversation.transcriptions.length === 1
                                    ? "message"
                                    : "messages"}
                                </span>
                                <span className="text-xs opacity-70">
                                  {formatDate(conversation.date)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              ) : (
                <div className="p-4 text-center text-muted-foreground">
                  {searchQuery
                    ? "No conversations match your search"
                    : "No conversations yet"}
                </div>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="p-3 sm:p-4 border-t border-border flex justify-between items-center">
          <Button variant="outline" size="icon" className="h-10 w-10">
            <Settings className="h-4 w-4" />
          </Button>
          {/* Theme Toggle */}
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            className="h-10 w-10"
          >
            <Sun className="h-4 w-4 dark:hidden" />
            <Moon className="h-4 w-4 hidden dark:block" />
          </Button>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
