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
        h4: ({ children }) => (
          <h4 className="text-base font-bold mb-2">{children}</h4>
        ),
        h5: ({ children }) => (
          <h5 className="text-sm font-bold mb-2">{children}</h5>
        ),
        h6: ({ children }) => (
          <h6 className="text-xs font-bold mb-2">{children}</h6>
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
            className="text-sky-400 hover:text-sky-300 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto mb-4">
            <table className="min-w-full border-collapse border border-gray-700">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-gray-800">{children}</thead>
        ),
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr className="border-b border-gray-700">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="px-4 py-2 text-left font-medium text-gray-300">
            {children}
          </th>
        ),
        td: ({ children }) => <td className="px-4 py-2">{children}</td>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-gray-500 pl-4 py-2 my-4 bg-gray-800 rounded-r">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-gray-600 my-4" />,
        img: ({ src, alt }) => (
          <img src={src} alt={alt} className="max-w-full h-auto my-4 rounded" />
        ),
        del: ({ children }) => (
          <del className="line-through text-gray-500">{children}</del>
        ),
        input: ({ checked }) => (
          <input
            type="checkbox"
            checked={checked}
            disabled={true}
            className="mr-2 h-4 w-4 rounded border-gray-700"
          />
        ),
        code: ({ inline, className, children, ...props }: any) => {
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
      <div className="markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {children}
        </ReactMarkdown>
      </div>
    );
  },
);

export default MarkdownComponent;
