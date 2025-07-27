import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import { Separator } from "../../ui/separator";
import CodeBlock from "../../chatui/CodeBlock";
import {
  Copy,
  Code,
  FileText,
  MessageSquare,
} from "lucide-react";
import { APIInfo } from "../useModelAPIInfo";

interface ExamplesTabProps {
  apiInfo: APIInfo;
  getHfModelId: () => string;
  copyToClipboard: (text: string, label: string) => void;
}

export const ExamplesTab: React.FC<ExamplesTabProps> = ({
  apiInfo,
  getHfModelId,
  copyToClipboard,
}) => (
  <Card className="border border-gray-700 shadow-sm bg-gray-800">
    <CardHeader className="bg-gray-700 border-b border-gray-600">
      <CardTitle className="flex items-center gap-2 text-white">
        <Code className="w-5 h-5 text-blue-400" />
        Code Examples
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-6 p-6">
      <div>
        <Label className="flex items-center gap-2 text-white mb-3">
          <MessageSquare className="w-4 h-4 text-blue-400" />
          Chat Completions API
        </Label>

        <Tabs defaultValue="curl" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-gray-900 border border-gray-600 rounded-lg p-1 mb-4">
            <TabsTrigger
              value="curl"
              className="text-white data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded-md transition-all"
            >
              cURL
            </TabsTrigger>
            <TabsTrigger
              value="typescript"
              className="text-white data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded-md transition-all"
            >
              TypeScript
            </TabsTrigger>
          </TabsList>

          <TabsContent value="curl" className="space-y-3">
            <div className="bg-gray-900 border border-gray-600 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-medium text-gray-300">
                  Chat Completions (cURL)
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(apiInfo.chat_curl_example, "cURL Command")
                  }
                  className="border-gray-600 hover:bg-gray-700 text-white h-8 px-3"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
              </div>
              <CodeBlock
                code={apiInfo.chat_curl_example}
                language="bash"
                showCopyButton={false}
              />
            </div>
            <p className="text-xs text-gray-400">
              OpenAI-compatible chat completions endpoint for conversational AI
            </p>
          </TabsContent>

          <TabsContent value="typescript" className="space-y-3">
            <div className="bg-gray-900 border border-gray-600 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-medium text-gray-300">
                  Chat Completions (TypeScript)
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(
                      `// TypeScript example using fetch
const response = await fetch("${apiInfo.endpoints.chat_completions}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiInfo.jwt_token}"
  },
  body: JSON.stringify({
    model: "${getHfModelId()}",
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
                      "TypeScript Code"
                    )
                  }
                  className="border-gray-600 hover:bg-gray-700 text-white h-8 px-3"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
              </div>
              <CodeBlock
                code={`// TypeScript example using fetch
const response = await fetch("${apiInfo.endpoints.chat_completions}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiInfo.jwt_token}"
  },
  body: JSON.stringify({
    model: "${getHfModelId()}",
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
console.log(data);`}
                language="typescript"
                showCopyButton={false}
              />
            </div>
            <p className="text-xs text-gray-400">
              TypeScript example using the chat completions API
            </p>
          </TabsContent>
        </Tabs>
      </div>

      <Separator className="bg-gray-600" />

      <div>
        <Label className="flex items-center gap-2 text-white mb-3">
          <FileText className="w-4 h-4 text-blue-400" />
          Completions API
        </Label>

        <Tabs defaultValue="curl-completions" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-gray-900 border border-gray-600 rounded-lg p-1 mb-4">
            <TabsTrigger
              value="curl-completions"
              className="text-white data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded-md transition-all"
            >
              cURL
            </TabsTrigger>
            <TabsTrigger
              value="typescript-completions"
              className="text-white data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded-md transition-all"
            >
              TypeScript
            </TabsTrigger>
          </TabsList>

          <TabsContent value="curl-completions" className="space-y-3">
            <div className="bg-gray-900 border border-gray-600 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-medium text-gray-300">
                  Completions (cURL)
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(
                      apiInfo.completions_curl_example,
                      "cURL Command"
                    )
                  }
                  className="border-gray-600 hover:bg-gray-700 text-white h-8 px-3"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
              </div>
              <CodeBlock
                code={apiInfo.completions_curl_example}
                language="bash"
                showCopyButton={false}
              />
            </div>
            <p className="text-xs text-gray-400">
              OpenAI-compatible completions endpoint for text generation
            </p>
          </TabsContent>

          <TabsContent value="typescript-completions" className="space-y-3">
            <div className="bg-gray-900 border border-gray-600 rounded-lg p-4">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-medium text-gray-300">
                  Completions (TypeScript)
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyToClipboard(
                      `// TypeScript example for completions
const response = await fetch("${apiInfo.endpoints.completions}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiInfo.jwt_token}"
  },
  body: JSON.stringify({
    model: "${getHfModelId()}",
    prompt: "What is Tenstorrent?",
    temperature: 0.9,
    top_k: 20,
    top_p: 0.9,
    max_tokens: 128,
    stream: false,
    stop: ["<|eot_id|>"]
  })
});

const data = await response.json();
console.log(data);`,
                      "TypeScript Code"
                    )
                  }
                  className="border-gray-600 hover:bg-gray-700 text-white h-8 px-3"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
              </div>
              <CodeBlock
                code={`// TypeScript example for completions
const response = await fetch("${apiInfo.endpoints.completions}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiInfo.jwt_token}"
  },
  body: JSON.stringify({
    model: "${getHfModelId()}",
    prompt: "What is Tenstorrent?",
    temperature: 0.9,
    top_k: 20,
    top_p: 0.9,
    max_tokens: 128,
    stream: false,
    stop: ["<|eot_id|>"]
  })
});

const data = await response.json();
console.log(data);`}
                language="typescript"
                showCopyButton={false}
              />
            </div>
            <p className="text-xs text-gray-400">
              TypeScript example using the completions API
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </CardContent>
  </Card>
); 