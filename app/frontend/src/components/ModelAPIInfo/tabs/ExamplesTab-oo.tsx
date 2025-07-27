import React, { useState } from "react";
import { Copy, Code, ChevronDown, Check, Star } from "lucide-react";
import { Button } from "../../ui/button";
import CodeBlock from "../../chatui/CodeBlock";

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
    <div className="rounded-2xl border border-gray-600 overflow-hidden bg-gray-800">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between bg-gray-800">
        <span className="text-white font-medium text-base text-left">
          {selectedLanguage}
        </span>

        <div className="flex items-center gap-3">
          {/* Language Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg text-sm transition-colors duration-150 border border-gray-600"
            >
              <Code className="w-4 h-4" />
              {selectedLanguage}
              <ChevronDown className="w-4 h-4" />
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 min-w-[140px]">
                {languages.map((lang) => (
                  <button
                    key={lang.name}
                    onClick={() => {
                      setSelectedLanguage(lang.name);
                      setIsDropdownOpen(false);
                    }}
                    className="flex items-center justify-between w-full px-4 py-3 text-sm text-gray-300 hover:bg-gray-700 transition-colors duration-150 first:rounded-t-lg last:rounded-b-lg text-left"
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
            className="p-2 h-10 w-10 hover:bg-gray-700 text-gray-400 hover:text-gray-300 transition-colors duration-150 rounded-lg"
          >
            {copyFeedback ? (
              <Check className="w-5 h-5" />
            ) : (
              <Copy className="w-5 h-5" />
            )}
          </Button>

          {/* Star Button */}
          <Button
            variant="ghost"
            size="sm"
            className="p-2 h-10 w-10 hover:bg-gray-700 text-gray-400 hover:text-gray-300 transition-colors duration-150 rounded-lg"
          >
            <Star className="w-5 h-5" />
          </Button>
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

// Demo component with sample data
export default function ExamplesTab() {
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
  };

  const chatCompletionsExamples = [
    {
      name: "cURL",
      language: "bash",
      code: `curl --request POST \\
--url https://api.vercel.com/v1/integrations/sso/token \\
--header 'Content-Type: application/json' \\
--data '{
"code": "<string>",
"state": "<string>",
"client_id": "<string>",
"client_secret": "<string>",
"redirect_uri": "<string>",
"grant_type": "authorization_code"
}'`,
    },
    {
      name: "TypeScript",
      language: "typescript",
      code: `// TypeScript example using fetch
const response = await fetch("https://api.example.com/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer your-token-here"
  },
  body: JSON.stringify({
    model: "gpt-3.5-turbo",
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
      name: "Javascript",
      language: "javascript",
      code: `// JavaScript example using fetch
const response = await fetch("https://api.example.com/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer your-token-here"
  },
  body: JSON.stringify({
    model: "gpt-3.5-turbo",
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
  ];

  return (
    <div className="space-y-6 p-6 bg-black">
      <LanguageToggleCodeBlock
        languages={chatCompletionsExamples}
        copyToClipboard={copyToClipboard}
      />
    </div>
  );
}
