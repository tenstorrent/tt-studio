// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Speech-to-text reliably mangles Tenstorrent product names — "QB2" comes back as
// "quiet box two", "Tenstorrent" as "tensor" or "ten store", "Tensix" as "ten six".
// That hurts twice: the vector search embeds the mangled words and misses the right
// documents, and the model then repeats the mangled name back to the user.
//
// One table feeds both fixes. `normalizeTranscriptForRetrieval` widens the RAG query
// (see chatui/getRagContext.ts) and `buildVocabularyPromptSection` renders the same
// table into the system prompt (see prompts.ts). Do not maintain two copies.

export interface VocabularyEntry {
  /** The spelling we want retrieved and spoken back. */
  canonical: string;
  /** Lowercase forms STT plausibly produces. Matched on word boundaries. */
  aliases: string[];
}

// QB2 first — it is the primary subject of most questions this agent gets asked.
export const TT_VOCABULARY: VocabularyEntry[] = [
  {
    canonical: "TT-QuietBox 2 (QB2)",
    aliases: [
      "qb2",
      "qb 2",
      "q b two",
      "quiet box",
      "quietbox",
      "quiet box 2",
      "quiet box two",
      "quietbox two",
      "tt quiet box",
      "quiet box too",
    ],
  },
  {
    canonical: "TT-LoudBox",
    aliases: ["loud box", "loudbox", "tt loud box", "cloud box"],
  },
  {
    canonical: "Tenstorrent",
    aliases: [
      "tensor",
      "tenzed",
      "tenzer",
      "ten store",
      "ten star",
      "ten storrent",
      "tenstorent",
      "ten torrent",
      "tensorrent",
      "tense torrent",
    ],
  },
  {
    canonical: "Tensix",
    aliases: ["tensics", "ten six", "tensix core", "ten sicks", "ten sics"],
  },
  {
    canonical: "Blackhole",
    aliases: ["black hole", "blackhole", "black whole"],
  },
  {
    canonical: "Wormhole",
    aliases: ["worm hole", "wormhole", "warm hole"],
  },
  {
    canonical: "n150",
    aliases: ["n 150", "n one fifty", "and 150", "in 150"],
  },
  {
    canonical: "n300",
    aliases: ["n 300", "n three hundred", "and 300"],
  },
  {
    canonical: "p100",
    aliases: ["p 100", "p one hundred"],
  },
  {
    canonical: "p150",
    aliases: ["p 150", "p one fifty", "pe 150"],
  },
  {
    canonical: "p300",
    aliases: ["p 300", "p three hundred"],
  },
  {
    canonical: "WH Galaxy",
    aliases: ["galaxy", "wh galaxy", "wormhole galaxy", "double galaxy"],
  },
  {
    canonical: "TT-Metal (TT-Metalium)",
    aliases: [
      "tt metal",
      "t t metal",
      "tea tea metal",
      "tt metalium",
      "metalium",
      "medallion",
      "tt medal",
    ],
  },
  {
    canonical: "TT-NN",
    aliases: ["tt nn", "t t n n", "tea tea n n", "tt and n"],
  },
  {
    canonical: "TT-Studio",
    aliases: ["tt studio", "t t studio", "tea tea studio", "tea studio"],
  },
  {
    canonical: "tt-inference-server",
    aliases: [
      "inference server",
      "tt inference server",
      "inferencer",
      "inference sir",
      "tt inference",
    ],
  },
  {
    canonical: "vLLM",
    aliases: ["v llm", "villm", "vee llm", "v l l m", "we llm"],
  },
  {
    canonical: "TT-Forge",
    aliases: ["tt forge", "t t forge", "forge"],
  },
];

// Longest alias first, so "quiet box two" wins over the "quiet box" prefix.
const SORTED_ENTRIES: { canonical: string; pattern: RegExp }[] = TT_VOCABULARY.flatMap(
  (entry) =>
    entry.aliases.map((alias) => ({
      canonical: entry.canonical,
      alias,
      // \b misbehaves against aliases that end in a digit followed by nothing, and
      // against multi-word aliases with internal spaces, so bound explicitly on
      // non-alphanumerics instead.
      pattern: new RegExp(
        `(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?=[^a-z0-9]|$)`,
        "i"
      ),
    }))
)
  .sort((a, b) => b.alias.length - a.alias.length)
  .map(({ canonical, pattern }) => ({ canonical, pattern }));

/**
 * Widen a spoken transcript with the canonical Tenstorrent terms it probably meant.
 *
 * Deliberately additive: the user's own wording is preserved and canonical terms are
 * appended. Replacing would be wrong here — "tensor" really does mean a tensor about
 * as often as it means Tenstorrent, and appending lets the embedding see both without
 * ever destroying the real question.
 */
export function normalizeTranscriptForRetrieval(text: string): string {
  if (!text?.trim()) return text;

  const matched: string[] = [];
  for (const { canonical, pattern } of SORTED_ENTRIES) {
    if (matched.includes(canonical)) continue;
    if (pattern.test(text)) matched.push(canonical);
  }

  if (!matched.length) return text;
  return `${text} ${matched.join(" ")}`;
}

/** The same table rendered for the system prompt, so the model resolves aliases too. */
export function buildVocabularyPromptSection(): string {
  const lines = TT_VOCABULARY.map(
    (entry) => `- ${entry.canonical} — may be heard as: ${entry.aliases.join(", ")}`
  );
  return [
    "Vocabulary: speech-to-text often garbles Tenstorrent product names. When the user's words are close to one of these, assume they meant it, and always say the canonical name back:",
    ...lines,
    'Treat these as the same thing the user is asking about — for example "how much memory does the quiet box two have" is a question about TT-QuietBox 2. Never comment on the mishearing or ask the user to repeat a name you can reasonably resolve.',
  ].join("\n");
}
