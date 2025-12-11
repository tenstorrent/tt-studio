// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState } from "react";
import { Copy, Code, ChevronDown, Check } from "lucide-react";
import { Button } from "../../ui/button";
import CodeBlock from "../../chatui/CodeBlock";

interface APIInfo {
  model_name: string;
  model_type: string;
  hf_model_id?: string;
  jwt_secret: string;
  jwt_token: string;
  example_payload: any;
  chat_curl_example: string;
  completions_curl_example: string;
  internal_url: string;
  health_url: string;
  endpoints: {
    chat_completions: string;
    completions: string;
    health: string;
    tt_studio_backend: string;
  };
  deploy_info: any;
}

interface LanguageToggleCodeBlockProps {
  languages: {
    name: string;
    code: string;
    language: string;
  }[];
  copyToClipboard: (text: string, label: string) => void;
}

const LanguageToggleCodeBlock: React.FC<LanguageToggleCodeBlockProps> = ({
  languages,
  copyToClipboard,
}) => {
  const [selectedLanguage, setSelectedLanguage] = useState(languages[0].name);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const selectedCode = languages.find((lang) => lang.name === selectedLanguage);

  const handleCopy = () => {
    if (selectedCode) {
      copyToClipboard(selectedCode.code, selectedLanguage);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-600 overflow-hidden dark:bg-zinc-900 dark:border-zinc-700 dark:text-white bg-zinc-100 ">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between bg-gray-700 dark:bg-zinc-900">
        <span className="text-white font-medium text-base text-left">
          {selectedLanguage}
        </span>

        <div className="flex items-center gap-3">
          {/* Language Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-2 bg-gray-600 hover:bg-gray-500 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg text-sm transition-colors duration-150 border border-gray-500 dark:border-gray-700"
            >
              <Code className="w-4 h-4" />
              {selectedLanguage}
              <ChevronDown className="w-4 h-4" />
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 bg-gray-700 dark:bg-zinc-900 border border-gray-600 dark:border-gray-700 rounded-lg shadow-xl z-10 min-w-[140px]">
                {languages.map((lang) => (
                  <button
                    key={lang.name}
                    onClick={() => {
                      setSelectedLanguage(lang.name);
                      setIsDropdownOpen(false);
                    }}
                    className="flex items-center justify-between w-full px-4 py-3 text-sm text-gray-300 hover:bg-gray-600 dark:hover:bg-gray-700 transition-colors duration-150 first:rounded-t-lg last:rounded-b-lg text-left"
                  >
                    <span className="flex items-center gap-2 text-left">
                      <Code className="w-4 h-4" />
                      {lang.name}
                    </span>
                    {selectedLanguage === lang.name && (
                      <Check className="w-4 h-4 text-blue-400" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Copy Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="p-2 h-10 w-10 hover:bg-gray-600 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-300 transition-colors duration-150 rounded-lg"
          >
            {copyFeedback ? (
              <Check className="w-5 h-5" />
            ) : (
              <Copy className="w-5 h-5" />
            )}
          </Button>
          {/* Star Button */}
          {/* <Button
            variant="ghost"
            size="sm"
            className="p-2 h-10 w-10 hover:bg-gray-600 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-300 transition-colors duration-150 rounded-lg"
          >
            <Star className="w-5 h-5" />
          </Button> */}
        </div>
      </div>

      {/* Code Container - Terminal Style */}
      <div className="bg-black rounded-b-2xl">
        {selectedCode && (
          <div className="p-6 text-left">
            <CodeBlock
              code={selectedCode.code}
              language={selectedCode.language}
              showCopyButton={false}
            />
          </div>
        )}
      </div>
    </div>
  );
};

interface ExamplesTabProps {
  apiInfo: APIInfo | null;
  modelId: string;
  modelName: string;
}

export default function ExamplesTab({
  apiInfo,
  modelId,
  modelName,
}: ExamplesTabProps) {
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    // mark variables as used to satisfy linter for this simple passthrough
    void label;
  };

  // Generate dynamic examples based on the actual model data
  const generateExamples = (): {
    name: string;
    language: string;
    code: string;
  }[] => {
    if (!apiInfo) {
      return [];
    }

    const modelIdValue = apiInfo.hf_model_id || modelId;
    // Use backend-provided endpoints which include correct host:port (e.g., :7000)
    const chatEndpoint = apiInfo.endpoints.chat_completions;
    const completionsEndpoint = apiInfo.endpoints.completions;

    return [
      {
        name: "cURL - Chat Completions",
        language: "bash",
        code:
          apiInfo.chat_curl_example ||
          `curl --request POST \\
--url "${chatEndpoint}" \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer ${apiInfo.jwt_token}' \\
--data '{
  "model": "${modelIdValue}",
  "messages": [
    {
      "role": "user",
      "content": "What is Tenstorrent?"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 100,
  "stream": false
}'`,
      },
      {
        name: "cURL - Completions",
        language: "bash",
        code:
          apiInfo.completions_curl_example ||
          `curl --request POST \\
--url "${completionsEndpoint}" \\
--header 'Content-Type: application/json' \\
--header 'Authorization: Bearer ${apiInfo.jwt_token}' \\
--data '{
  "model": "${modelIdValue}",
  "prompt": "What is Tenstorrent?",
  "temperature": 0.7,
  "max_tokens": 100,
  "stream": false
}'`,
      },
      {
        name: "TypeScript",
        language: "typescript",
        code: `// TypeScript example using fetch
const response = await fetch("${chatEndpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiInfo.jwt_token}"
  },
  body: JSON.stringify({
    model: "${modelIdValue}",
    messages: [
      {
        role: "user",
        content: "What is Tenstorrent?"
      }
    ],
    temperature: 0.7,
    max_tokens: 100,
    stream: false
  })
});

const data = await response.json();
console.log(data);`,
      },
      {
        name: "JavaScript",
        language: "javascript",
        code: `// JavaScript example using fetch
const response = await fetch("${chatEndpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiInfo.jwt_token}"
  },
  body: JSON.stringify({
    model: "${modelIdValue}",
    messages: [
      {
        role: "user",
        content: "What is Tenstorrent?"
      }
    ],
    temperature: 0.7,
    max_tokens: 100,
    stream: false
  })
});

const data = await response.json();
console.log(data);`,
      },
      {
        name: "Python",
        language: "python",
        code: `# Python example using requests
import requests
import json

url = "${chatEndpoint}"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiInfo.jwt_token}"
}

data = {
    "model": "${modelIdValue}",
    "messages": [
        {
            "role": "user",
            "content": "What is Tenstorrent?"
        }
    ],
    "temperature": 0.7,
    "max_tokens": 100,
    "stream": False
}

response = requests.post(url, headers=headers, json=data)
result = response.json()
print(result)`,
      },
    ];
  };

  const examples = generateExamples();

  if (!apiInfo) {
    return (
      <div className="space-y-6 p-6 bg-black">
        <div className="text-center text-gray-400">Loading examples...</div>
      </div>
    );
  }

  // mark prop as used to satisfy linter in case it is not referenced elsewhere
  void modelName;

  return (
    <div className="space-y-6 p-6 bg-black">
      <LanguageToggleCodeBlock
        languages={examples}
        copyToClipboard={copyToClipboard}
      />
    </div>
  );
}
