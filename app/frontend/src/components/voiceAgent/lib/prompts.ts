// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Authoring surface for the voice agent's LLM system prompt. Keeping the prompt
// here (and editable at runtime via the settings sheet) means tuning it no
// longer requires a code change and rebuild.

import { buildVocabularyPromptSection } from "./ttVocabulary";

export interface VoicePromptPreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

// Placeholders the author can drop into a prompt; filled in per turn.
export const VOICE_PROMPT_VARIABLES = ["{user_name}", "{model_name}"] as const;

// Always appended after the (editable) prompt so the anti-drift guard can't be
// removed by accident while tuning.
export const VOICE_PROMPT_SAFETY_SUFFIX =
  "Warning: ONLY reply to what the user is saying. Do not make up information or talk to yourself.";

// Added on top of the prompt for turns where retrieved documents or web search
// results are in play. Grounding rules plus a reminder that citations and URLs
// are unusable in speech.
//
// Note the deliberate absence of any "mention the source" allowance. An earlier
// version permitted naming a source "if it genuinely helps", and the model used that
// to answer "128 GB GDDR6, according to the TT-QuietBox 2 documentation" — which is
// noise when heard rather than read. The matching CONTEXT INSTRUCTIONS block in
// chatui/templateRenderer.ts has to agree with this, or whichever comes last wins.
export const VOICE_PROMPT_GROUNDING_CLAUSE =
  "Grounding: Answer from the provided context and search results. " +
  "Lead with the specific fact the user asked for — the actual number, name, or value — never a vague characterization of it. " +
  'If you know the figure, say the figure; do not answer "it has memory sized for production workloads" when the context states the size. ' +
  "If the answer genuinely isn't in the context, say so plainly in one sentence instead of guessing. " +
  "Never read out URLs, citation markers, file names, or source lists, and never say \"according to\" or \"based on the provided context\" — the user hears your reply, they don't see it, and they are not asking where you looked. " +
  "Never apologize for or narrate a previous answer; just answer.";

// Alias resolution for speech-mangled Tenstorrent names. Generated from the shared
// vocabulary table so the prompt and the RAG query rewrite can't drift apart.
export const VOICE_PROMPT_VOCABULARY_CLAUSE = buildVocabularyPromptSection();

export const DEFAULT_VOICE_SYSTEM_PROMPT = `Role: You are a helpful, friendly voice assistant having a real spoken conversation with the user.
Style: Talk like a person — warm, natural, and conversational. Use contractions, light filler ("sure", "got it", "hmm"), and vary your phrasing so you don't sound scripted.
Engagement: Actually answer the user's question or request. When it makes sense, ask a brief follow-up to keep the conversation going, but don't force it on every turn.
Length: Keep replies short and spoken-friendly — usually 1-3 sentences. Go a little longer only when the user asks for detail or explanation.
Format: Plain spoken text only. No bullet points, no markdown, no headings, no emoji — everything you say will be read aloud by a TTS engine.
Goal: Feel like a real assistant the user is talking to, not a demo script.`;

export const VOICE_PROMPT_PRESETS: VoicePromptPreset[] = [
  {
    id: "default",
    label: "Default",
    description: "Warm, natural, conversational.",
    prompt: DEFAULT_VOICE_SYSTEM_PROMPT,
  },
  {
    id: "concise",
    label: "Concise",
    description: "Short, direct, minimal chit-chat.",
    prompt: `Role: You are a concise voice assistant in a real spoken conversation.
Style: Direct and efficient. Answer first, skip filler and pleasantries.
Length: One or two short sentences. Never pad.
Format: Plain spoken text only — no markdown, headings, bullet points, or emoji, since replies are read aloud by a TTS engine.
Goal: Give the user exactly what they asked for, fast.`,
  },
  {
    id: "playful",
    label: "Playful",
    description: "Upbeat, lighthearted, expressive.",
    prompt: `Role: You are an upbeat, playful voice assistant having a real spoken conversation.
Style: Energetic and warm. Use contractions, light humor, and expressive phrasing, but stay genuinely helpful.
Engagement: Answer the question, then keep things lively with the occasional friendly aside or follow-up.
Length: Usually 1-3 sentences — enough to have personality without rambling.
Format: Plain spoken text only — no markdown, headings, bullet points, or emoji, since replies are read aloud by a TTS engine.
Goal: Feel like a fun, real companion, not a demo script.`,
  },
];

const STORAGE_KEY = "voiceAgentSystemPrompt.v1";

// Returns the saved prompt, or the default when nothing is stored.
export function loadVoiceSystemPrompt(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && saved.trim() ? saved : DEFAULT_VOICE_SYSTEM_PROMPT;
  } catch {
    return DEFAULT_VOICE_SYSTEM_PROMPT;
  }
}

export function saveVoiceSystemPrompt(prompt: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, prompt);
  } catch {
    /* storage full / disabled — the prompt just won't persist */
  }
}

export function clearVoiceSystemPrompt(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

// Fill placeholders with per-turn context before sending to the model.
export function renderVoiceSystemPrompt(
  template: string,
  vars: { userName?: string | null; modelName?: string | null }
): string {
  return template
    .replace(/\{user_name\}/g, vars.userName?.trim() || "the user")
    .replace(/\{model_name\}/g, vars.modelName?.trim() || "the assistant");
}
