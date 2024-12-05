// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeBlock from "./CodeBlock";

interface MarkdownComponentProps {
  children: string;
}

const MarkdownComponent: React.FC<MarkdownComponentProps> = React.memo(
  ({ children }) => {
    const components: Partial<Components> = useMemo(
      () => ({
        h1: ({ children }) => (
          <h1 className="text-2xl font-bold mb-2">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-xl font-bold mb-2">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-lg font-bold mb-2">{children}</h3>
        ),
        strong: ({ children }) => (
          <strong className="font-bold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => (
          <ul className="list-disc pl-5 mb-2">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 mb-2">{children}</ol>
        ),
        li: ({ children }) => <li className="mb-1">{children}</li>,
        p: ({ children }) => <p className="mb-2">{children}</p>,
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-blue-500 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        code: ({ inline, className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className || "");
          if (!inline && match) {
            return (
              <CodeBlock
                blockMatch={{
                  output: String(children).replace(/\n$/, ""),
                  language: match[1],
                }}
              />
            );
          }
          return (
            <code
              className={`${className} bg-gray-800 rounded px-1`}
              {...props}
            >
              {children}
            </code>
          );
        },
      }),
      [],
    );

    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    );
  },
);

export default MarkdownComponent;
