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
    .replace(/<\|eot_id\|>/g, "")
    .replace(/<\|start_header_id\|>assistant/g, "")
    .replace(/<\|end_header_id\|>/g, "")
    .replace(/<\|start_header_id\|>/g, "")
    .replace(/\bassistant\b/g, "")
    .replace(/\buser\b/g, "")
    .trim();
};

const StreamingMessage: React.FC<StreamingMessageProps> = React.memo(
  function StreamingMessage({ content, isStreamFinished }) {
    const [renderedContent, setRenderedContent] = useState("");
    const contentRef = useRef(cleanContent(content));
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const renderNextChunk = useCallback(() => {
      setRenderedContent((prev) => {
        const nextChunk = contentRef.current.slice(
          prev.length,
          prev.length + 10,
        );
        return prev + nextChunk;
      });
    }, []);

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
          intervalRef.current = setInterval(() => {
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
    prevProps.content === nextProps.content,
);

export default StreamingMessage;
