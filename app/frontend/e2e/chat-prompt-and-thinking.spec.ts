// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { test, expect } from "@playwright/test";
import {
  buildDefaultSystemPrompt,
  generatePrompt,
} from "../src/components/chatui/templateRenderer";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_REPEATED_THINKING_LINES,
  MAX_THINKING_CHARS,
  getTokenLimitsForModel,
  isRunawayThinking,
} from "../src/components/chatui/tokenLimits";

test.describe("chat system prompt and runaway thinking safeguards (#1422)", () => {
  test("generatePrompt matches Model Parameters default prompt without hidden RESPONSE FORMAT lines", () => {
    const messages = generatePrompt(
      [
        {
          sender: "user",
          text: "In two short sentences, tell me what a Tenstorrent Blackhole chip is.",
        },
      ],
      null,
      null,
      "Tenstorrent QuietBox (P300x2)",
      "Qwen3.5-9B"
    );

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe(
      buildDefaultSystemPrompt("Qwen3.5-9B", "Tenstorrent QuietBox (P300x2)")
    );
    expect(messages[0].content).not.toContain("RESPONSE FORMAT");
    expect(messages[0].content).not.toContain("SAFETY GUIDELINES");
  });

  test("generatePrompt appends RAG guidelines and context only when RAG documents are provided", () => {
    const messages = generatePrompt(
      [{ sender: "user", text: "Summarize the architecture." }],
      { documents: ["[From spec.md] Blackhole uses Tensix cores."] },
      null,
      "P300x2",
      "Qwen3.5-9B"
    );

    expect(messages[0].content).toContain("SAFETY GUIDELINES:");
    expect(messages[0].content).toContain("RELEVANT CONTEXT:");
    expect(messages[0].content).toContain("[Source: spec.md]");
    expect(messages[0].content).not.toContain("RESPONSE FORMAT");
  });

  test("getTokenLimitsForModel caps defaultMaxTokens at DEFAULT_MAX_OUTPUT_TOKENS while keeping full sliderMax", () => {
    const limits = getTokenLimitsForModel(9, 262144);
    expect(limits.sliderMax).toBe(262144);
    expect(limits.defaultMaxTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);

    const smaller = getTokenLimitsForModel(7, 16384);
    expect(smaller.sliderMax).toBe(16384);
    expect(smaller.defaultMaxTokens).toBe(12288);
  });

  test("isRunawayThinking detects repeated reasoning loops and oversized thinking traces", () => {
    const normalReasoning = [
      "First, let us recall what Blackhole is.",
      "Second, keep the explanation to two short sentences.",
    ].join("\n");
    expect(isRunawayThinking(normalReasoning)).toBe(false);

    const repeatedLine =
      'Wait, I need to check if I should output the "RESPONSE FORMAT" lines as part of the response.';
    const loopingTrace = Array.from(
      { length: MAX_REPEATED_THINKING_LINES },
      () => repeatedLine
    ).join("\n");
    expect(isRunawayThinking(loopingTrace)).toBe(true);

    const oversizedTrace = "a".repeat(MAX_THINKING_CHARS + 1);
    expect(isRunawayThinking(oversizedTrace)).toBe(true);
  });
});
