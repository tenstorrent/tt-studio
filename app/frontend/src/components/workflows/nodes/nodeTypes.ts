// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { NodeTypes } from "@xyflow/react";
import InputNode from "./InputNode";
import OutputNode from "./OutputNode";
import LLMNode from "./LLMNode";
import RAGQueryNode from "./RAGQueryNode";
import AgentNode from "./AgentNode";

export const nodeTypes: NodeTypes = {
  input: InputNode,
  output: OutputNode,
  llm: LLMNode,
  rag_query: RAGQueryNode,
  agent: AgentNode,
};
