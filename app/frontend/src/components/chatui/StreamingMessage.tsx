// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import MarkdownComponent from "./MarkdownComponent";

interface StreamingMessageProps {
  content: string;
  isStreamFinished: boolean;
}

const cleanContent = (content: string): string => {
  return content
    .replace(/<\|.*?\|>(&gt;)?/g, "")
    .replace(/\b(assistant|user)\b/gi, "")
    .replace(/[<>]/g, "")
    .replace(/&(lt|gt);/g, "")
    .trim();
};

const StreamingMessage: React.FC<StreamingMessageProps> = React.memo(
  function StreamingMessage({ content, isStreamFinished }) {
    const [renderedContent, setRenderedContent] = useState("");
    const contentRef = useRef(cleanContent(content));
    const intervalRef = useRef<number | null>(null);
    const lastChunkRef = useRef("");

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
      contentRef.current = cleanContent(content);

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
    }, [content, isStreamFinished, renderNextChunk, renderedContent]);

    return (
      <div className="relative">
        <MarkdownComponent>{renderedContent}</MarkdownComponent>
        {!isStreamFinished && (
          <motion.span
            className="absolute bottom-0 right-0 text-white"
            initial={{ opacity: 1 }}
            animate={{ opacity: [1, 0.5, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            ▋
          </motion.span>
        )}
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.isStreamFinished === nextProps.isStreamFinished &&
    prevProps.content === nextProps.content
);

export default StreamingMessage;
