// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { APIInfo } from "@/src/components/ModelAPIInfo/useModelAPIInfo";

export interface EndpointRow {
  label: string;
  /** e.g. `POST`, `GET`, `Bearer` */
  method: string;
  value: string;
  description: string;
}

/** The endpoints and credentials shown on the Endpoints tab. */
export function getEndpointRows(
  api: APIInfo,
  hfModelId: string
): EndpointRow[] {
  const rows: EndpointRow[] = [];
  if (api.inference_route) {
    rows.push({
      label: "Inference endpoint",
      method: "POST",
      value: `${window.location.origin}${api.inference_route}`,
      description: "TT-Studio inference endpoint for this model.",
    });
  } else {
    rows.push(
      {
        label: "Chat completions",
        method: "POST",
        value: api.endpoints.chat_completions,
        description: "OpenAI-compatible chat completions endpoint.",
      },
      {
        label: "Completions",
        method: "POST",
        value: api.endpoints.completions,
        description: "OpenAI-compatible text completions endpoint.",
      }
    );
  }
  rows.push(
    {
      label: "Health",
      method: "GET",
      value: api.endpoints.health,
      description: "Model health check.",
    },
    {
      label: "Authentication token",
      method: "Bearer",
      value: api.jwt_token,
      description:
        "Send as `Authorization: Bearer <token>` with every request.",
    }
  );
  if (hfModelId) {
    rows.push({
      label: "Hugging Face model ID",
      method: "ID",
      value: hfModelId,
      description: "Pass as `model` in OpenAI-compatible requests.",
    });
  }
  return rows;
}

export type ExampleLanguage = "bash" | "python" | "typescript" | "javascript";

export interface CodeExample {
  name: string;
  language: ExampleLanguage;
  code: string;
}

/** Ready-to-run request examples, matching the ones the old API page offered. */
export function getCodeExamples(
  api: APIInfo,
  deployId: string,
  hfModelId: string
): CodeExample[] {
  if (api.inference_route) {
    const url = `${window.location.origin}${api.inference_route}`;
    switch (api.model_type) {
      case "speech_recognition":
        return [
          {
            name: "cURL – Speech to text",
            language: "bash",
            code: `curl -X POST "${url}" \\\n  -F "deploy_id=${deployId}" \\\n  -F "file=@/path/to/audio.wav"`,
          },
        ];
      case "tts":
        return [
          {
            name: "cURL – Text to speech",
            language: "bash",
            code: `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "deploy_id": "${deployId}",\n    "text": "Hello from Tenstorrent"\n  }' \\\n  --output tts_output.wav`,
          },
        ];
      case "image_generation":
        return [
          {
            name: "cURL – Image generation",
            language: "bash",
            code: `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "deploy_id": "${deployId}",\n    "prompt": "A beautiful sunset over mountains"\n  }' \\\n  --output image.jpg`,
          },
        ];
      case "object_detection":
        return [
          {
            name: "cURL – Object detection",
            language: "bash",
            code: `curl -X POST "${url}" \\\n  -F "deploy_id=${deployId}" \\\n  -F "image=@/path/to/image.jpg"`,
          },
        ];
      case "embedding":
        return [
          {
            name: "cURL – Embedding",
            language: "bash",
            code: `curl -X POST "${url}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "deploy_id": "${deployId}",\n    "input": "Hello from Tenstorrent"\n  }'`,
          },
        ];
      default:
        return [
          {
            name: "cURL",
            language: "bash",
            code: `curl -X POST "${url}" \\\n  -F "deploy_id=${deployId}"`,
          },
        ];
    }
  }

  const model = hfModelId || deployId;
  const chat = api.endpoints.chat_completions;
  const body = `{
    "model": "${model}",
    "messages": [{ "role": "user", "content": "What is Tenstorrent?" }],
    "temperature": 0.7,
    "max_tokens": 100,
    "stream": false
  }`;
  return [
    {
      name: "cURL – Chat completions",
      language: "bash",
      code:
        api.chat_curl_example ||
        `curl -X POST "${chat}" \\\n  -H "Authorization: Bearer ${api.jwt_token}" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`,
    },
    {
      name: "cURL – Completions",
      language: "bash",
      code:
        api.completions_curl_example ||
        `curl -X POST "${api.endpoints.completions}" \\\n  -H "Authorization: Bearer ${api.jwt_token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "model": "${model}", "prompt": "What is Tenstorrent?", "max_tokens": 100 }'`,
    },
    {
      name: "Python",
      language: "python",
      code: `import requests

url = "${chat}"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${api.jwt_token}",
}
data = {
    "model": "${model}",
    "messages": [{"role": "user", "content": "What is Tenstorrent?"}],
    "temperature": 0.7,
    "max_tokens": 100,
    "stream": False,
}

response = requests.post(url, headers=headers, json=data)
print(response.json())`,
    },
    {
      name: "TypeScript",
      language: "typescript",
      code: `const response = await fetch("${chat}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer ${api.jwt_token}",
  },
  body: JSON.stringify({
    model: "${model}",
    messages: [{ role: "user", content: "What is Tenstorrent?" }],
    temperature: 0.7,
    max_tokens: 100,
    stream: false,
  }),
});

const data: unknown = await response.json();
console.log(data);`,
    },
    {
      name: "JavaScript",
      language: "javascript",
      code: `const response = await fetch("${chat}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer ${api.jwt_token}",
  },
  body: JSON.stringify({
    model: "${model}",
    messages: [{ role: "user", content: "What is Tenstorrent?" }],
    temperature: 0.7,
    max_tokens: 100,
    stream: false,
  }),
});

console.log(await response.json());`,
    },
  ];
}
