// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Split a reply into its reasoning (`<think>` blocks, including variants some
 * models use) and its answer. `thinkingOpen` is true while the model is still
 * reasoning mid-stream.
 */
export function splitThinking(text: string) {
  const normalized = text
    .replace(/<(thought|reasoning)>/gi, "<think>")
    .replace(/<\/(thought|reasoning)>/gi, "</think>");
  const thinking: string[] = [];
  let answer = normalized;
  let thinkingOpen = false;
  answer = answer.replace(
    /<think>([\s\S]*?)<\/think>/gi,
    (_, inner: string) => {
      thinking.push(inner.trim());
      return "";
    }
  );
  const open = answer.search(/<think>/i);
  if (open >= 0) {
    thinking.push(answer.slice(open + "<think>".length).trim());
    answer = answer.slice(0, open);
    thinkingOpen = true;
  }
  // some templates leave a dangling close tag when the opening one is implied
  const dangling = answer.search(/<\/think>/i);
  if (dangling >= 0) {
    thinking.push(answer.slice(0, dangling).trim());
    answer = answer.slice(dangling + "</think>".length);
  }
  return {
    thinking: thinking.filter(Boolean).join("\n\n"),
    answer: answer.trim(),
    thinkingOpen,
  };
}
