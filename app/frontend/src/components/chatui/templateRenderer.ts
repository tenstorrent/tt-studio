// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import nunjucks from "nunjucks";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Template String for Nunjucks
const promptTemplate = `
{{- bos_token }}

{#- System message #}
{{- "<|start_header_id|>system<|end_header_id|>\\n\\n" }}
{{- "Cutting Knowledge Date: December 2023\\n" }}
{{- "Today Date: " + date_string + "\\n\\n" }}
{{- system_message }}
{{- "<|eot_id|>" }}

{#- Messages #}
{%- for message in messages %}
    {%- if message.role in ['user', 'assistant'] %}
        {{- '<|start_header_id|>' + message['role'] + '<|end_header_id|>\\n\\n'+ message['content'] | trim + '<|eot_id|>' }}
    {%- endif %}
{%- endfor %}

{%- if add_generation_prompt %}
    {{- '<|start_header_id|>assistant<|end_header_id|>\\n\\n' }}
{%- endif %}
`;

export function generatePrompt(
  chatHistory: { sender: string; text: string }[],
  ragContext: { documents: string[] } | null = null,
  add_generation_prompt: boolean = true,
): string {
  console.log("generatePrompt received RAG context:", ragContext);

  const preparedChatHistory: ChatMessage[] = chatHistory.map((message) => ({
    role: message.sender === "user" ? "user" : "assistant",
    content: message.text,
  }));

  const processedRagContext = ragContext
    ? ragContext.documents.flat().join("\n\n")
    : "";
  return renderPrompt(
    preparedChatHistory,
    processedRagContext,
    add_generation_prompt,
  );
}

export function renderPrompt(
  chatHistory: ChatMessage[],
  ragContext: string = "",
  add_generation_prompt: boolean = true,
): string {
  try {
    console.log("Rendering prompt with chat history:", chatHistory);
    console.log("RAG context in renderPrompt:", ragContext);

    const today = new Date();
    const date_string = today.toISOString().split("T")[0];

    let system_message = "You are a helpful AI assistant.";
    if (ragContext) {
      system_message = `Use the given context to answer the prompt:\n\n${ragContext}\n\n${system_message}`;
    }

    const renderedPrompt = nunjucks.renderString(promptTemplate, {
      bos_token: "<|begin_of_text|>",
      date_string: date_string,
      system_message: system_message,
      messages: chatHistory,
      add_generation_prompt: add_generation_prompt,
    });
    return renderedPrompt;
  } catch (error) {
    console.error("Error rendering the prompt:", error);
    throw error;
  }
}
