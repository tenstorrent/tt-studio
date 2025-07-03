// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React from "react";
import { CodeBlock, dracula } from "react-code-blocks";

interface CodeBlocksProps {
  code: string;
  language: string;
  showLineNumbers: boolean;
}

const CodeBlocks: React.FC<CodeBlocksProps> = ({
  code,
  language,
  showLineNumbers,
}) => {
  return (
    <CodeBlock
      text={code}
      language={language}
      showLineNumbers={showLineNumbers}
      theme={dracula}
    />
  );
};

export default CodeBlocks;
