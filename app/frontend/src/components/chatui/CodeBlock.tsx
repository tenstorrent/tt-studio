// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import type { CodeToHtmlOptions } from "@llm-ui/code";
import {
  loadHighlighter,
  useCodeBlockToHtml,
  allLangs,
  allLangsAlias,
} from "@llm-ui/code";
import parseHtml from "html-react-parser";
import { getHighlighterCore } from "shiki/core";
import { bundledLanguagesInfo } from "shiki/langs";
import githubDark from "shiki/themes/github-dark.mjs";
import getWasm from "shiki/wasm";

const highlighter = loadHighlighter(
  getHighlighterCore({
    langs: allLangs(bundledLanguagesInfo),
    langAlias: allLangsAlias(bundledLanguagesInfo),
    themes: [githubDark],
    loadWasm: getWasm,
  }),
);

const codeToHtmlOptions: CodeToHtmlOptions = {
  theme: "github-dark",
};

interface CodeBlockProps {
  blockMatch: {
    output: string;
    language: string;
  };
}

const CodeBlock: React.FC<CodeBlockProps> = ({ blockMatch }) => {
  // Normalize language name and provide fallback
  const normalizeLanguage = (lang: string): string => {
    const normalized = lang.toLowerCase().trim();
    if (normalized === "pytho" || normalized === "py") return "python";
    // Add more language normalizations here if needed
    return normalized;
  };

  const language = normalizeLanguage(blockMatch.language);

  const { html, code } = useCodeBlockToHtml({
    markdownCodeBlock: `\`\`\`${language}\n${blockMatch.output}\n\`\`\``,
    highlighter,
    codeToHtmlOptions,
  });

  if (!html) {
    // Fallback to <pre> if Shiki is not loaded yet or language is not recognized
    return (
      <pre className="bg-gray-800 rounded-md p-4 my-4 overflow-x-auto">
        <code className="text-white text-sm">{code}</code>
      </pre>
    );
  }

  return (
    <div className="relative group">
      <div className="bg-gray-800 rounded-md p-4 my-4 overflow-x-auto">
        {parseHtml(html)}
      </div>
      <button
        className="absolute top-2 right-2 bg-gray-700 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => navigator.clipboard.writeText(code)}
      >
        Copy
      </button>
    </div>
  );
};

export default CodeBlock;
