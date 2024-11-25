// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useEffect, useRef } from "react";
import { useLLMOutput, LLMOutputComponent } from "@llm-ui/react";
import { markdownLookBack } from "@llm-ui/markdown";
import {
  codeBlockLookBack,
  findCompleteCodeBlock,
  findPartialCodeBlock,
} from "@llm-ui/code";
import MarkdownComponent from "./MarkdownComponent";
import CodeBlock from "./CodeBlock";

interface StreamingMessageProps {
  content: string;
  isStreamFinished: boolean;
}

const StreamingMessage: React.FC<StreamingMessageProps> = React.memo(
  function StreamingMessage({ content, isStreamFinished }) {
    const contentRef = useRef(content);

    useEffect(() => {
      contentRef.current = content;
    }, [content]);

    const { blockMatches } = useLLMOutput({
      llmOutput: content,
      fallbackBlock: {
        component: MarkdownComponent,
        lookBack: markdownLookBack(),
      },
      blocks: [
        {
          component: CodeBlock,
          findCompleteMatch: findCompleteCodeBlock(),
          findPartialMatch: findPartialCodeBlock(),
          lookBack: codeBlockLookBack(),
        },
      ],
      isStreamFinished,
    });

    return (
      <div className="text-white whitespace-pre-wrap overflow-x-auto">
        {blockMatches.map((blockMatch, index) => {
          const Component = blockMatch.block.component as LLMOutputComponent;
          return <Component key={index} blockMatch={blockMatch} />;
        })}
      </div>
    );
  },
);

export default StreamingMessage;
