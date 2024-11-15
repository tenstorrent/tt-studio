// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import type { CodeToHtmlOptions } from "@llm-ui/code";
import {
  allLangs,
  allLangsAlias,
  loadHighlighter,
  useCodeBlockToHtml,
} from "@llm-ui/code";
import { LLMOutputComponent } from "@llm-ui/react";
import { getHighlighterCore } from "shiki/core";
import { bundledLanguagesInfo } from "shiki/langs";
import githubDark from "shiki/themes/github-dark.mjs";
import getWasm from "shiki/wasm";
import parseHtml from "html-react-parser";

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

const CodeBlock: LLMOutputComponent = ({ blockMatch }) => {
  const isStreaming = !blockMatch.isComplete;
  const { html, code } = useCodeBlockToHtml({
    markdownCodeBlock: blockMatch.output,
    highlighter,
    codeToHtmlOptions,
  });

  if (isStreaming || !html) {
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
