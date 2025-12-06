// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import nlp from "compromise";

interface QueryIntent {
  type: string;
  action?: string;
  details: string[];
}

// Domain-specific terms that should be preserved
const DOMAIN_TERMS = new Set([
  "tenstorrent",
  "grayskull",
  "wormhole",
  "blackhole",
  "tt",
  "ai",
  "ml",
  "gpu",
  "tensor",
  "core",
  "chip",
  "architecture",
  "processor",
  "compute",
  "memory",
]);

// Common technical terms that should be preserved
const TECHNICAL_TERMS = new Set([
  "api",
  "http",
  "https",
  "json",
  "xml",
  "rest",
  "graphql",
  "websocket",
  "tcp",
  "udp",
  "ip",
  "dns",
  "ssl",
  "tls",
  "jwt",
  "oauth",
  "auth",
]);

// Common technical actions/verbs that should be preserved
const TECHNICAL_ACTIONS = new Set([
  "run",
  "execute",
  "start",
  "stop",
  "restart",
  "deploy",
  "build",
  "compile",
  "test",
  "debug",
  "log",
  "trace",
  "monitor",
  "analyze",
  "optimize",
  "configure",
  "setup",
  "install",
  "uninstall",
  "update",
  "upgrade",
  "downgrade",
  "backup",
  "restore",
  "sync",
  "clone",
  "fork",
  "merge",
  "push",
  "pull",
  "commit",
  "revert",
  "reset",
  "checkout",
]);

// Combine all preserved terms
const PRESERVED_TERMS = new Set([
  ...DOMAIN_TERMS,
  ...TECHNICAL_TERMS,
  ...TECHNICAL_ACTIONS,
]);

// Action patterns for better intent detection
const ACTION_PATTERNS = {
  debug: [
    "debug",
    "troubleshoot",
    "fix",
    "resolve",
    "error",
    "issue",
    "problem",
  ],
  deploy: ["deploy", "run", "start", "launch", "execute"],
  configure: ["configure", "setup", "install", "set", "define"],
  monitor: ["monitor", "watch", "observe", "track", "log"],
  analyze: ["analyze", "examine", "inspect", "review", "check"],
  optimize: ["optimize", "improve", "enhance", "speed up", "performance"],
};

// Common stop words that should be removed
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "he",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "that",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "this",
  "that",
  "these",
  "those",
  "i",
  "me",
  "my",
  "myself",
  "we",
  "our",
  "ours",
  "ourselves",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "he",
  "him",
  "his",
  "himself",
  "she",
  "her",
  "hers",
  "herself",
  "it",
  "its",
  "itself",
  "they",
  "them",
  "their",
  "theirs",
  "themselves",
  // Add contractions and common query words
  "whats",
  "wheres",
  "whos",
  "hows",
  "whens",
  "whys",
  "thats",
  "heres",
  "theres",
  "lets",
  "cant",
  "dont",
  "wont",
  "shouldnt",
  "couldnt",
  "wouldnt",
  "doesnt",
  "isnt",
  "arent",
  "wasnt",
  "werent",
  "havent",
  "hasnt",
  "hadnt",
  "tell",
  "show",
  "explain",
  "describe",
  "give",
  "find",
  "look",
  "search",
  "please",
  "thanks",
  "thank",
  "hello",
  "hi",
  "hey",
]);

// Intent-specific context keywords
const INTENT_CONTEXT_KEYWORDS: Record<string, string[]> = {
  debug: [
    "error",
    "issue",
    "problem",
    "fix",
    "troubleshoot",
    "log",
    "crash",
    "fail",
  ],
  deploy: [
    "setup",
    "install",
    "configure",
    "run",
    "start",
    "environment",
    "config",
  ],
  howto: ["guide", "tutorial", "steps", "process", "procedure", "method"],
  explain: ["concept", "overview", "architecture", "design", "purpose", "why"],
  search: ["find", "locate", "where", "which", "what", "list"],
};

export const preprocessQuery = (query: string): string => {
  // console.log("🔄 Starting query preprocessing:", query);

  // Convert to lowercase and trim
  let processed = query.toLowerCase().trim();
  // console.log("📝 After lowercase and trim:", processed);

  // Remove special characters and punctuation
  processed = processed.replace(/[^\w\s]/g, " ");
  // console.log("🔤 After removing special characters:", processed);

  // Use compromise for advanced text processing
  const doc = nlp(processed);

  // Process terms while preserving domain-specific and technical terms
  const terms = doc
    .terms()
    .not("#StopWord") // Remove stop words
    .not("#Value") // Remove numbers
    .not("#Punctuation") // Remove punctuation
    .out("array")
    .filter((text: string) => {
      // Remove common stop words that compromise might have missed
      if (STOP_WORDS.has(text)) {
        // console.log("🗑️ Removing stop word:", text);
        return false;
      }
      // Preserve domain-specific and technical terms
      if (PRESERVED_TERMS.has(text)) {
        // console.log("🔒 Preserving term:", text);
        return text;
      }
      return text;
    });

  // console.log("📋 Extracted terms:", terms);

  // Join the processed terms
  processed = terms.join(" ");

  // Remove extra whitespace
  processed = processed.replace(/\s+/g, " ").trim();

  // If query becomes empty after processing, return original query
  const finalProcessed = processed.trim() || query.trim();
  // console.log("✅ Final processed query:", finalProcessed);

  return finalProcessed;
};

export const expandQuery = (query: string): string => {
  // console.log("🔄 Starting query expansion:", query);

  const doc = nlp(query);

  // Get base terms
  const baseTerms = doc
    .terms()
    .not("#StopWord")
    .not("#Value")
    .not("#Punctuation")
    .normalize()
    .out("array");

  // console.log("📋 Base terms for expansion:", baseTerms);

  // Add synonyms for common technical terms and actions
  const synonyms: Record<string, string[]> = {
    // Error-related
    error: ["issue", "problem", "bug", "fault", "failure"],
    fix: ["resolve", "repair", "correct", "debug", "troubleshoot"],

    // Action-related
    run: ["execute", "start", "launch", "deploy"],
    stop: ["halt", "terminate", "end", "kill"],
    restart: ["reboot", "reload", "refresh"],
    build: ["compile", "make", "create", "generate"],
    test: ["verify", "validate", "check", "examine"],
    log: ["record", "track", "monitor", "trace"],
    configure: ["setup", "install", "set", "define"],
    update: ["upgrade", "modify", "change", "alter"],
    delete: ["remove", "erase", "clear", "drop"],
    show: ["display", "view", "list", "present"],
    get: ["fetch", "retrieve", "obtain", "acquire"],
    set: ["configure", "define", "assign", "establish"],
  };

  // Expand terms with synonyms
  const expandedTerms = baseTerms.map((term: string) => {
    const termSynonyms = synonyms[term] || [];
    // console.log(`📚 Expanding term "${term}" with synonyms:`, termSynonyms);
    return [term, ...termSynonyms].join(" ");
  });

  const finalExpanded = expandedTerms.join(" ");
  // console.log("✅ Final expanded query:", finalExpanded);

  return finalExpanded;
};

export const analyzeQueryIntent = (query: string): QueryIntent => {
  // console.log("🔄 Starting intent analysis:", query);

  const doc = nlp(query);
  const intent: QueryIntent = {
    type: "information",
    action: undefined,
    details: [],
  };

  // Check for simple greetings first
  const greetingWords = [
    "hi",
    "hello",
    "hey",
    "hiya",
    "greetings",
    "good morning",
    "good afternoon",
    "good evening",
    "howdy",
    "sup",
    "what's up",
    "whats up",
    "yo",
  ];
  const cleaned = query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "");
  if (greetingWords.includes(cleaned)) {
    intent.type = "greeting";
    // console.log("👋 Detected greeting type");
    return intent;
  }

  // Check for question words
  if (doc.has("^#QuestionWord")) {
    intent.type = "question";
    // console.log("❓ Detected question type");
  }

  // Check for command-like queries
  if (doc.has("^#Verb")) {
    intent.type = "command";
    // console.log("⚡ Detected command type");
  }

  // Check for error-related queries
  if (doc.has("error|issue|problem|bug|fault|crash|fail")) {
    intent.type = "debug";
    intent.action = "debug";
    // console.log("⚠️ Detected debug type");
  }

  // Check for help-related queries
  if (doc.has("help|assist|support|aid|guide")) {
    intent.type = "help";
    // console.log("🆘 Detected help type");
  }

  // Detect specific actions and add context keywords
  for (const [action, patterns] of Object.entries(ACTION_PATTERNS)) {
    if (patterns.some((pattern) => doc.has(pattern))) {
      intent.action = action;
      // Add intent-specific context keywords to details
      intent.details.push(...(INTENT_CONTEXT_KEYWORDS[action] || []));
      // console.log(`🎯 Detected action: ${action} with context keywords`);
      break;
    }
  }

  // Extract important details (nouns, technical terms)
  const nounTerms: string[] = doc.nouns().out("array");
  const domainTerms: string[] = doc
    .match(Array.from(DOMAIN_TERMS).join("|"))
    .out("array");
  const technicalTerms: string[] = doc
    .match(Array.from(TECHNICAL_TERMS).join("|"))
    .out("array");

  intent.details = [
    ...intent.details,
    ...nounTerms,
    ...domainTerms,
    ...technicalTerms,
  ].filter((term): term is string => typeof term === "string");

  // console.log("✅ Final intent analysis:", intent);
  return intent;
};

export const processQuery = (
  query: string
): {
  processed: string;
  expanded: string;
  intent: QueryIntent;
} => {
  const processed = preprocessQuery(query);
  const expanded = expandQuery(processed);
  const intent = analyzeQueryIntent(query);

  return {
    processed,
    expanded,
    intent,
  };
};
