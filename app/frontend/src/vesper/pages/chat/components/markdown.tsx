// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import bash from "@shikijs/langs/bash";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import python from "@shikijs/langs/python";
import typescript from "@shikijs/langs/typescript";
import { Code } from "@tenstorrent/vesper/code";
import { CodeBlock, type CodeBlockProps } from "@tenstorrent/vesper/code-block";
import { Typography } from "@tenstorrent/vesper/typography";

type Lang = CodeBlockProps["lang"];
// the app's hoisted shiki grammars are structurally what vesper expects
const GRAMMARS: Record<string, Lang> = {
  bash: bash as unknown as Lang,
  sh: bash as unknown as Lang,
  shell: bash as unknown as Lang,
  javascript: javascript as unknown as Lang,
  js: javascript as unknown as Lang,
  json: json as unknown as Lang,
  python: python as unknown as Lang,
  py: python as unknown as Lang,
  typescript: typescript as unknown as Lang,
  ts: typescript as unknown as Lang,
  tsx: typescript as unknown as Lang,
};

const components: Components = {
  p: ({ children }) => (
    <Typography variant="copy-md" className="text-vesper-text-primary">
      {children}
    </Typography>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline text-vesper-text-link-default hover:text-vesper-text-link-hover"
    >
      {children}
    </a>
  ),
  h1: ({ children }) => (
    <Typography
      as="h3"
      variant="heading-sm"
      className="text-vesper-text-primary"
    >
      {children}
    </Typography>
  ),
  h2: ({ children }) => (
    <Typography
      as="h4"
      variant="heading-xs"
      className="text-vesper-text-primary"
    >
      {children}
    </Typography>
  ),
  h3: ({ children }) => (
    <Typography
      as="h5"
      variant="copy-md-bold"
      className="text-vesper-text-primary"
    >
      {children}
    </Typography>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-vesper-6 flex flex-col gap-vesper-1 text-vesper-text-primary">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-vesper-6 flex flex-col gap-vesper-1 text-vesper-text-primary">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <Typography as="li" variant="copy-md">
      {children}
    </Typography>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-vesper-border-secondary pl-vesper-4 text-vesper-text-secondary">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm text-vesper-text-primary">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-vesper-border-secondary px-vesper-3 py-vesper-2 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-vesper-border-tertiary px-vesper-3 py-vesper-2">
      {children}
    </td>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const match = /language-([\w-]+)/.exec(className ?? "");
    const text = String(children ?? "").replace(/\n$/, "");
    // fenced blocks carry a language (or span lines); everything else is inline
    if (!match && !text.includes("\n")) return <Code>{text}</Code>;
    return (
      <CodeBlock
        lang={match ? (GRAMMARS[match[1].toLowerCase()] ?? "text") : "text"}
        className="my-vesper-2"
      >
        {text}
      </CodeBlock>
    );
  },
};

/** Assistant replies rendered as markdown, in vesper styles. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-vesper-3 min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
