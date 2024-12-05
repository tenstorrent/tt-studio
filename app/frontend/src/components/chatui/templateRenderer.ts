// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import nunjucks from "nunjucks";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Template String for Nunjucks
const promptTemplate = `
<|begin_of_text|>
{% for message in chat_history %}
<|start_header_id|>{{ message.role }}<|end_header_id|>
\n\n{{ message.content }}{% if not loop.last %}<|eot_id|>{% endif %}
{% endfor %}
<|start_header_id|>assistant<|end_header_id|>\n\n
`;

export function renderPrompt(chatHistory: ChatMessage[]): string {
  try {
    console.log("Rendering prompt with chat history:", chatHistory);
    const renderedPrompt = nunjucks.renderString(promptTemplate, {
      chat_history: chatHistory,
    });
    return renderedPrompt;
  } catch (error) {
    console.error("Error rendering the prompt:", error);
    throw error;
  }
}
