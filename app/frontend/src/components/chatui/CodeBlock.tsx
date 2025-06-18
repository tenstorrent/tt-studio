// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import type { CodeToHtmlOptions } from "@llm-ui/code";
import { loadHighlighter, useCodeBlockToHtml, allLangs, allLangsAlias } from "@llm-ui/code";
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
  })
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

const normalizeLanguage = (lang: string): string => {
  const normalized = lang.toLowerCase().trim();
  switch (normalized) {
    case "pyt":
    case "pytho":
    case "py":
    case "python":
      return "python";
    case "js":
    case "javascript":
      return "javascript";
    case "ts":
    case "typescript":
      return "typescript";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "json":
      return "json";
    case "java":
      return "java";
    case "cpp":
    case "c++":
      return "cpp";
    case "c#":
    case "csharp":
    case "cs":
      return "csharp";
    case "go":
    case "golang":
      return "go";
    case "rust":
    case "rs":
      return "rust";
    case "swift":
      return "swift";
    case "kotlin":
    case "kt":
      return "kotlin";
    case "ruby":
    case "rb":
      return "ruby";
    case "php":
      return "php";
    // Add more language mappings as needed
    default:
      // If the language is not recognized, default to 'plaintext'
      return "plaintext";
  }
};

const CodeBlock: React.FC<CodeBlockProps> = ({ blockMatch }) => {
  const language = normalizeLanguage(blockMatch.language);

  const { html, code } = useCodeBlockToHtml({
    markdownCodeBlock: `\`\`\`${language}\n${blockMatch.output}\n\`\`\``,
    highlighter,
    codeToHtmlOptions,
  });

  const renderCode = () => {
    if (html) {
      return parseHtml(html);
    }
    // Fallback to plain text rendering if HTML generation fails
    return (
      <pre className="text-white text-sm">
        <code>{code}</code>
      </pre>
    );
  };

  return (
    <div className="relative group">
      <div className="bg-gray-800 rounded-md p-4 my-4 overflow-x-auto">{renderCode()}</div>
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
