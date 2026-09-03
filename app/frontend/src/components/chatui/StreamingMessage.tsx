// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC


import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Search, ChevronDown } from "lucide-react";
import MarkdownComponent from "./MarkdownComponent";

interface StreamingMessageProps {
  content: string;
  isStreamFinished: boolean;
  isStopped?: boolean;
  onThinkingBlocksChange?: (hasThinking: boolean, blocks: string[]) => void;
  showThinking?: boolean;
  hideThinkingPanel?: boolean;
}

interface ProcessedContent {
  cleanedContent: string;
  thinkingBlocks: string[];
}

interface SourceLink {
  title: string;
  url: string;
}

interface SearchInfo {
  isSearch: boolean;
  queries: string[];
  sources: SourceLink[];
  isDone: boolean;
}

const parseSearchInfo = (text: string): SearchInfo => {
  const queries: string[] = [];
  const sources: SourceLink[] = [];
  const seenUrls = new Set<string>();

  const searchRegex = /Searching:\s*(.+)/g;
  let m;
  while ((m = searchRegex.exec(text)) !== null) {
    const q = m[1].trim();
    if (q) queries.push(q);
  }

  // Parse "Source: [title](url)" lines emitted by the agent
  const sourceRegex = /Source:\s*\[([^\]]*)\]\(([^)]+)\)/g;
  while ((m = sourceRegex.exec(text)) !== null) {
    const title = m[1].trim();
    const url = m[2].trim();
    if (url && !seenUrls.has(url)) {
      seenUrls.add(url);
      sources.push({ title: title || url, url });
    }
  }

  // [searching] marker signals the agent is about to search,
  // even before specific queries arrive.
  const hasSearchSignal = /\[searching\]/.test(text);

  return {
    isSearch: queries.length > 0 || sources.length > 0 || hasSearchSignal,
    queries,
    sources,
    isDone: /\bDone\b/.test(text) || sources.length > 0,
  };
};

const LEAKED_TOOL_CALL_RE = /\{\s*"name"\s*:\s*"[^"]*(?:tavily|search)[^"]*"\s*,\s*"(?:parameters|arguments)"\s*:\s*\{[^}]*\}\s*\}/gi;

// A reply that opens with a "Thinking Process:" heading is a scratchpad, not an
// answer. Qwen3.5-9B writes its reasoning that way — plain prose, no <think>
// tags and no reasoning_content — so vLLM's reasoning parsers, which key off
// the tags, pass it straight through as reply text.
const PROSE_THINKING_HEADING = /^[\s#*_]*(?:thinking|thought)\s+process\s*:/i;
// It ends where the answer begins: a gap of two or more blank lines. Steps
// within the outline are separated by a single blank line.
const PROSE_THINKING_END = /\n[ \t]*\n[ \t]*\n/;

/** Normalize any variant thinking tags (<thought>, <reasoning>) to <think> */
const normalizeThinkingTags = (content: string): string => {
  if (!content) return content;
  return content
    .replace(/<thought>/gi, "<think>")
    .replace(/<\/thought>/gi, "</think>")
    .replace(/<reasoning>/gi, "<think>")
    .replace(/<\/reasoning>/gi, "</think>");
};

/** Tag an untagged prose scratchpad so it renders in the thinking panel. */
const tagProseThinking = (
  content: string,
  isStreamFinished: boolean
): string => {
  if (/<\/?think>/i.test(content) || !PROSE_THINKING_HEADING.test(content)) {
    return content;
  }

  const answerGap = PROSE_THINKING_END.exec(content);
  if (answerGap) {
    return `<think>${content.slice(0, answerGap.index)}</think>${content.slice(
      answerGap.index + answerGap[0].length
    )}`;
  }

  // No answer section. Mid-stream the model is still reasoning; if the stream is
  // over it never reached an answer (it ran out of tokens mid-scratchpad), which
  // is the same empty-reply-with-thinking state a parsed reasoning model shows
  // when it is cut off. Either way the text stays reachable through the panel.
  return isStreamFinished ? `<think>${content}</think>` : `<think>${content}`;
};

/** Close a thinking block the stream ended inside, so it stays readable.
 *
 * Belt to runInference's braces: any path that leaves an unterminated <think>
 * (a stopped stream, a reply restored from history, a model whose reasoning
 * never gave way to an answer) would otherwise fail the closed-tag regex below,
 * be stripped from the reply text, and vanish along with the live panel. */
const closeUnterminatedThinking = (
  content: string,
  isStreamFinished: boolean
): string => {
  if (!isStreamFinished) return content;
  const openIdx = content.lastIndexOf("<think>");
  if (openIdx === -1 || content.includes("</think>", openIdx)) return content;
  return `${content}</think>`;
};

const processContent = (content: string): ProcessedContent => {
  const thinkingBlocks: string[] = [];

  // Qwen-style chat templates put the opening <think> in the prompt, so the
  // model streams only the closing </think>. If the server ran without a
  // reasoning parser, that thinking arrives inline — restore the opening tag
  // so it lands in the thinking block instead of the visible reply.
  const closeIdx = content.indexOf("</think>");
  if (closeIdx !== -1 && !content.slice(0, closeIdx).includes("<think>")) {
    content = "<think>" + content;
  }

  // Extract completed thinking blocks with <think>...</think> tags (before cleaning)
  const thinkingRegex = /<think>(.*?)<\/think>/gis;
  let match;
  while ((match = thinkingRegex.exec(content)) !== null) {
    thinkingBlocks.push(match[1].trim());
  }

  // Clean the content - be aggressive about removing thinking tokens
  const cleanedContent = content
    .replace(/[[<|]*python_tag[\]>|]*/gi, "")
    .replace(/<\|.*?\|>(&gt;)?/g, "")
    .replace(/\b(assistant|user)\b/gi, "")
    .replace(/\|(?:eot_id|start_header_id)\|/g, "")
    .replace(/^think\s+.*?\/think\s*/gims, "")
    .replace(/^think\s+.*$/ims, "")
    .replace(/^\s*think\b.*$/ims, "")
    .replace(/^\/think\s*/gim, "")
    .replace(/<think>.*?<\/think>/gis, "")
    .replace(/<think>.*$/is, "")
    .replace(/<\/think>/gi, "")
    .replace(/\/think/gi, "")
    .replace(/[<>]/g, "")
    .replace(/&(lt|gt);/g, "")
    .replace(/^\s*t\s*$/gm, "")
    .replace(LEAKED_TOOL_CALL_RE, "")
    .replace(/\{\s*"name"\s*:\s*"[^"]*(?:tavily|search)[^"]*"[\s\S]*$/i, "")
    .replace(/\btool_calls?\b.*/gi, "")
    .replace(/^\s*tool_cal?\s*$/gim, "")
    .replace(/Source:\s*\[[^\]]*\]\([^)]+\)\s*/g, "")
    .trim();

  return { cleanedContent, thinkingBlocks };
};

const StreamingMessage: React.FC<StreamingMessageProps> = React.memo(
  function StreamingMessage({
    content,
    isStreamFinished,
    isStopped,
    onThinkingBlocksChange,
    showThinking: externalShowThinking,
    hideThinkingPanel = false,
  }) {
    // Everything below reasons about thinking in terms of <think> tags, so
    // normalize prose scratchpads into tags once, up front.
    const streamOver = isStreamFinished || Boolean(isStopped);
    const normalizedContent = normalizeThinkingTags(content);
    const taggedContent = closeUnterminatedThinking(
      tagProseThinking(normalizedContent, streamOver),
      streamOver
    );

    const [renderedContent, setRenderedContent] = useState("");
    const [showThinking, setShowThinking] = useState(Boolean(externalShowThinking));
    const [showSearchDetails, setShowSearchDetails] = useState(false);
    // Check if thinking is actively streaming (has <think> but no closing </think>)
    const isThinkingActive =
      !streamOver && /<think>(?!.*<\/think>)/is.test(taggedContent);
    const contentRef = useRef(processContent(taggedContent).cleanedContent);
    const thinkingBlocksRef = useRef<string[]>([]);
    const intervalRef = useRef<number | null>(null);
    const lastChunkRef = useRef("");
    const thinkingScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      setShowThinking(Boolean(externalShowThinking));
    }, [externalShowThinking]);

    const renderNextChunk = useCallback(() => {
      const currentContent = contentRef.current;
      const currentRenderedLength = renderedContent.length;
      const nextChunk = currentContent.slice(
        currentRenderedLength,
        currentRenderedLength + 10
      );

      if (nextChunk !== lastChunkRef.current) {
        lastChunkRef.current = nextChunk;
        setRenderedContent(currentContent.slice(0, currentRenderedLength + 10));
      }
    }, [renderedContent]);

    useEffect(() => {
      const processed = processContent(taggedContent);
      contentRef.current = processed.cleanedContent;
      thinkingBlocksRef.current = processed.thinkingBlocks;

      // Notify parent about thinking blocks
      if (onThinkingBlocksChange) {
        onThinkingBlocksChange(
          processed.thinkingBlocks.length > 0,
          processed.thinkingBlocks
        );
      }

      if (isStreamFinished) {
        setRenderedContent(contentRef.current);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        if (!intervalRef.current) {
          intervalRef.current = window.setInterval(() => {
            if (renderedContent.length < contentRef.current.length) {
              renderNextChunk();
            } else {
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            }
          }, 10);
        }
      }

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }, [
      taggedContent,
      isStreamFinished,
      streamOver,
      renderNextChunk,
      renderedContent,
      onThinkingBlocksChange,
    ]);

    const hasThinking = thinkingBlocksRef.current.length > 0;

    // // Debug logging
    // console.log("[StreamingMessage] Render:", {
    //   hasThinking,
    //   showThinking,
    //   thinkingBlocksCount: thinkingBlocksRef.current.length,
    //   isStreamFinished,
    // });

    // Extract live thinking text from incomplete <think> block during streaming
    const lastThinkOpen = isThinkingActive ? taggedContent.lastIndexOf("<think>") : -1;
    const liveThinkingText =
      lastThinkOpen !== -1 ? taggedContent.slice(lastThinkOpen + 7) : null;

    // Detect whether the thinking block represents a web search
    const liveSearchInfo = liveThinkingText ? parseSearchInfo(liveThinkingText) : null;
    const completedSearchInfo = hasThinking
      ? parseSearchInfo(thinkingBlocksRef.current.join("\n"))
      : null;
    const isSearchMode = liveSearchInfo?.isSearch || completedSearchInfo?.isSearch;

    // Auto-scroll thinking box to bottom as tokens arrive
    useEffect(() => {
      if (thinkingScrollRef.current) {
        thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
      }
    }, [liveThinkingText]);

    return (
      <div className="relative">
        <AnimatePresence>
          {(isThinkingActive || hasThinking) && (
            <motion.div
              key="thinking-panel"
              layout
              className="mb-3 overflow-hidden"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <AnimatePresence mode="popLayout">
                {isThinkingActive ? (
                  <motion.div
                    key="live"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={{ duration: 0.2 }}
                  >
                    {hideThinkingPanel || (isSearchMode && liveSearchInfo) ? (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <motion.div
                            className="flex-shrink-0"
                            animate={{ rotate: [0, 360] }}
                            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                          >
                            <Globe size={14} className="text-blue-400" />
                          </motion.div>
                          <motion.span
                            className="text-sm italic text-gray-400"
                            animate={{ opacity: [1, 0.5, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          >
                            Searching the web…
                          </motion.span>
                        </div>
                        {liveSearchInfo && liveSearchInfo.queries.length > 0 && (
                          <div className="rounded-md bg-gray-800/50 border border-gray-700 px-3 py-2">
                            {liveSearchInfo.queries.map((q, i) => (
                              <div key={i} className="flex items-center gap-2 py-1 text-sm text-gray-300">
                                <Search size={12} className="flex-shrink-0 text-gray-500" />
                                <span>{q}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <motion.span
                            className="text-gray-400"
                            animate={{ opacity: [1, 0.5, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          >
                            💭
                          </motion.span>
                          <span className="text-sm italic text-gray-400">Thinking...</span>
                        </div>
                        <p className="text-xs text-gray-600 mb-1.5">
                          The model is reasoning before responding.
                        </p>
                        <div
                          ref={thinkingScrollRef}
                          className="max-h-36 overflow-y-auto rounded-md bg-gray-800/50 border border-gray-700 px-3 py-2 text-sm text-gray-300 font-mono leading-relaxed whitespace-pre-wrap"
                        >
                          {liveThinkingText}
                        </div>
                      </>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="collapsed"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={{ duration: 0.2, delay: 0.05 }}
                  >
                    {hideThinkingPanel || (isSearchMode && completedSearchInfo) ? (
                      <div>
                        <button
                          onClick={() => setShowSearchDetails(!showSearchDetails)}
                          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 transition-colors group"
                        >
                          <Globe size={14} className="text-blue-400/70" />
                          <span>Searched the web</span>
                          <ChevronDown
                            size={14}
                            className={`text-gray-500 transition-transform duration-200 ${showSearchDetails ? "rotate-180" : ""}`}
                          />
                        </button>
                        <AnimatePresence>
                          {showSearchDetails && completedSearchInfo && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="mt-2 overflow-hidden"
                            >
                              <div className="rounded-lg bg-gray-800/50 border border-gray-700 overflow-hidden">
                                {completedSearchInfo.queries.length > 0 && (
                                  <div className="px-3 py-2">
                                    <div className="text-xs text-gray-500 font-medium mb-1.5">
                                      {completedSearchInfo.queries.length} {completedSearchInfo.queries.length === 1 ? "search" : "searches"}
                                    </div>
                                    {completedSearchInfo.queries.map((q, i) => (
                                      <div key={i} className="flex items-center gap-2 py-1 text-sm text-gray-300">
                                        <Search size={12} className="flex-shrink-0 text-gray-500" />
                                        <span>{q}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ) : (
                      <div>
                        <button
                          onClick={() => setShowThinking(!showThinking)}
                          className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 transition-colors"
                        >
                          <span className="text-xs">{showThinking ? "▼" : "▶"}</span>
                          <span className="italic">{showThinking ? "Hide" : "Show"} thinking process</span>
                        </button>
                        <AnimatePresence>
                          {showThinking && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="mt-2 overflow-hidden"
                            >
                              <p className="text-xs text-gray-600 mb-1.5">
                                The model reasoned before responding.
                              </p>
                              <div className="max-h-48 overflow-y-auto rounded-md bg-gray-800/50 border border-gray-700 p-3">
                                {thinkingBlocksRef.current.map((block, index) => (
                                  <div key={index} className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                                    {block}
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {renderedContent.length === 0 && !isStreamFinished && !isThinkingActive && !isStopped ? (
          <motion.span
            className="text-gray-400"
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            ...
          </motion.span>
        ) : (
          <MarkdownComponent>{renderedContent}</MarkdownComponent>
        )}
        {!isStreamFinished && !isStopped && renderedContent.length > 0 && (
          <motion.span
            className="absolute bottom-0 right-0 text-white"
            initial={{ opacity: 1 }}
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            ▋
          </motion.span>
        )}
        {isStopped && (
          <div className="mt-2 text-red-500 font-bold text-sm">
            [Stopped by User]
          </div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.isStreamFinished === nextProps.isStreamFinished &&
    prevProps.content === nextProps.content &&
    prevProps.isStopped === nextProps.isStopped &&
    prevProps.showThinking === nextProps.showThinking &&
    prevProps.hideThinkingPanel === nextProps.hideThinkingPanel
);

export default StreamingMessage;
