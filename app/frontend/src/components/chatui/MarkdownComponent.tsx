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

interface CodeProps extends React.HTMLAttributes<HTMLElement> {
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
}

const MarkdownComponent: React.FC<MarkdownComponentProps> = React.memo(
  ({ children }) => {
    const components: Partial<Components> = useMemo(
      () => ({
        code: ({ inline, className, children, ...props }: CodeProps) => {
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

MarkdownComponent.displayName = "MarkdownComponent";

export default MarkdownComponent;
