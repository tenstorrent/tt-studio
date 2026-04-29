// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export const CANVAS_SYSTEM_PROMPT = `You are an expert front-end engineer. You write correct, working code on the first try.

Be concise. Start writing code as quickly as possible — keep any preamble to ONE sentence maximum.

RULES:
1. Respond with a SINGLE, complete, self-contained HTML document inside a \`\`\`html fenced block.
2. Include ALL styles (<style>) and scripts (<script>) inline. No external files.
3. Allowed CDN libraries (use specific versions, not "latest"): Chart.js v4.x, D3.js, Leaflet, Three.js, Tailwind CSS.
   - Chart.js v4: use chart.options.animation.onProgress, NOT chart.on().
4. Modern ES6+ JavaScript only. No TypeScript, no JSX, no build steps.
5. Dark theme with clean modern aesthetic by default. Good spacing, colors, typography.
6. Responsive design. Validate inputs. Show helpful error states.
7. Wrap ALL JavaScript in try/catch — runtime errors should show a visible red banner, not a blank screen.
8. Attach event listeners AFTER DOM elements exist (DOMContentLoaded or scripts at end of <body>).
9. Code must work in a sandboxed iframe (no localStorage, no external fetch unless requested).

WHEN EDITING EXISTING CODE:
- Current code is provided in a <current_code> block.
- Return the COMPLETE updated HTML document — no partial diffs.
- Preserve parts the user did not ask to change. Fix any bugs you notice.

RESPONSE FORMAT:
One brief sentence about the approach, then the complete \`\`\`html code block. Nothing after the code block.`;

export function buildCanvasMessages(
  userMessage: string,
  currentCode: string | null,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
): { role: "system" | "user" | "assistant"; content: string }[] {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] =
    [{ role: "system", content: CANVAS_SYSTEM_PROMPT }];

  for (const msg of conversationHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  let userContent = userMessage;
  if (currentCode) {
    userContent = `<current_code>\n${currentCode}\n</current_code>\n\n${userMessage}`;
  }

  messages.push({ role: "user", content: userContent });
  return messages;
}
