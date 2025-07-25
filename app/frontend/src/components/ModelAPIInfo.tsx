// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import { Alert, AlertDescription } from "./ui/alert";
import { Spinner } from "./ui/spinner";
import { Textarea } from "./ui/textarea";
import { customToast } from "./CustomToaster";
import CodeBlock from "./chatui/CodeBlock";
import {
  Copy,
  Code,
  Terminal,
  Settings,
  ExternalLink,
  FileText,
  Key,
  Globe,
  Play,
  CheckCircle,
  XCircle,
} from "lucide-react";

interface ModelAPIInfoProps {
  modelId: string;
  modelName: string;
  onClose: () => void;
}

interface APIInfo {
  model_name: string;
  model_type: string;
  api_url: string;
  jwt_secret: string;
  jwt_token: string;
  example_payload: any;
  curl_example: string;
  internal_url: string;
  health_url: string;
  deploy_info: any;
}

export const ModelAPIInfo: React.FC<ModelAPIInfoProps> = ({
  modelId,
  modelName,
  onClose,
}) => {
  const [apiInfo, setApiInfo] = useState<APIInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [testLoading, setTestLoading] = useState(false);
  const [requestPayload, setRequestPayload] = useState("");
  const [response, setResponse] = useState("");
  const [responseStatus, setResponseStatus] = useState<number | null>(null);

  useEffect(() => {
    loadAPIInfo();
  }, [modelId]);

  const loadAPIInfo = async () => {
    try {
      setLoading(true);

      // Call the backend API to get real API information
      const response = await fetch("/models-api/api-info/");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const apiInfoData = await response.json();
      const modelApiInfo = apiInfoData[modelId];

      if (!modelApiInfo) {
        throw new Error(`No API information found for model ${modelId}`);
      }

      setApiInfo(modelApiInfo);
      setRequestPayload(JSON.stringify(modelApiInfo.example_payload, null, 2));
    } catch (error) {
      console.error("Error loading API info:", error);
      customToast.error("Failed to load API information");

      // Fallback to mock data if backend fails
      const mockApiInfo: APIInfo = {
        model_name: modelName,
        model_type: "ChatModel",
        api_url: `${window.location.origin}/models-api/inference/`,
        jwt_secret: "your-jwt-secret-here",
        jwt_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        example_payload: {
          deploy_id: modelId,
          prompt: "What is Tenstorrent?",
          temperature: 1.0,
          top_k: 20,
          top_p: 0.9,
          max_tokens: 128,
          stream: true,
          stop: ["<|eot_id|>"],
        },
        curl_example: `curl -X POST "${window.location.origin}/models-api/inference/" \\
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "deploy_id": "${modelId}",
    "model": "your-model-name",
    "prompt": "What is Tenstorrent?",
    "temperature": 1.0,
    "top_k": 20,
    "top_p": 0.9,
    "max_tokens": 128,
    "stream": true,
    "stop": ["<|eot_id|>"]
  }'`,
        internal_url: "localhost:7000",
        health_url: "localhost:7000/health",
        deploy_info: {},
      };

      setApiInfo(mockApiInfo);
      setRequestPayload(JSON.stringify(mockApiInfo.example_payload, null, 2));
    } finally {
      setLoading(false);
    }
  };

  const handleTestAPI = async () => {
    if (!apiInfo) return;

    try {
      setTestLoading(true);
      setResponse("");
      setResponseStatus(null);

      let payload;
      try {
        payload = JSON.parse(requestPayload);
      } catch (error) {
        customToast.error("Invalid JSON payload");
        return;
      }

      // Validate required fields
      if (!payload.deploy_id) {
        customToast.error("Payload must include 'deploy_id' field");
        return;
      }

      // Make a real API call to test the endpoint
      console.log("Testing API with payload:", payload);
      console.log("API URL:", apiInfo.api_url);
      
      const response = await fetch(apiInfo.api_url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiInfo.jwt_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      setResponseStatus(response.status);

      if (response.ok) {
        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body reader available");
        }

        let responseText = "";
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            responseText += chunk;
            
            // Update response in real-time as chunks arrive
            setResponse(responseText);
          }
        } finally {
          reader.releaseLock();
        }

        customToast.success("API test completed successfully");
      } else {
        const errorText = await response.text();
        setResponse(`Error ${response.status}: ${errorText}`);
        customToast.error(`API test failed with status ${response.status}`);
      }
    } catch (error) {
      console.error("Error testing API:", error);
      setResponse(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      customToast.error("Failed to test API");
    } finally {
      setTestLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    customToast.success(`${label} copied to clipboard!`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner className="w-8 h-8" />
        <span className="ml-2">Loading API information...</span>
      </div>
    );
  }

  if (!apiInfo) {
    return (
      <Alert>
        <XCircle className="h-4 w-4" />
        <AlertDescription>
          No API information available for this model.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">API Information: {modelName}</h2>
          <p className="text-gray-600 dark:text-gray-300">
            Access OpenAI-compatible API endpoints for this model
          </p>
        </div>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>

      <Tabs defaultValue="endpoints" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="endpoints" className="flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Endpoints
          </TabsTrigger>
          <TabsTrigger value="test" className="flex items-center gap-2">
            <Play className="w-4 h-4" />
            Test API
          </TabsTrigger>
          <TabsTrigger value="examples" className="flex items-center gap-2">
            <Code className="w-4 h-4" />
            Examples
          </TabsTrigger>
        </TabsList>

        <TabsContent value="endpoints" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                API Endpoint Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    API URL
                  </Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                      {apiInfo.api_url}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(apiInfo.api_url, "API URL")
                      }
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    JWT Token
                  </Label>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm font-mono">
                      {apiInfo.jwt_token.substring(0, 20)}...
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(apiInfo.jwt_token, "JWT Token")
                      }
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <Label className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Model Information
                </Label>
                <div className="mt-2 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      Model Name:
                    </span>
                    <span className="font-medium">{apiInfo.model_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      Model Type:
                    </span>
                    <Badge variant="outline">{apiInfo.model_type}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-300">
                      Internal URL:
                    </span>
                    <span className="font-mono text-sm">
                      {apiInfo.internal_url}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="test" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                API Test Console
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="payload">Request Payload (JSON)</Label>
                <div className="mt-1">
                  <Textarea
                    id="payload"
                    value={requestPayload}
                    onChange={(e) => setRequestPayload(e.target.value)}
                    placeholder="Enter JSON payload..."
                    className="font-mono text-sm"
                    rows={10}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleTestAPI}
                  disabled={testLoading}
                  className="flex items-center gap-2"
                >
                  {testLoading ? (
                    <Spinner className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  Test API
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setRequestPayload(
                      JSON.stringify(apiInfo.example_payload, null, 2)
                    )
                  }
                >
                  Reset to Example
                </Button>
              </div>

              {responseStatus !== null && (
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      responseStatus >= 200 && responseStatus < 300
                        ? "default"
                        : "destructive"
                    }
                    className="flex items-center gap-1"
                  >
                    {responseStatus >= 200 && responseStatus < 300 ? (
                      <CheckCircle className="w-3 h-3" />
                    ) : (
                      <XCircle className="w-3 h-3" />
                    )}
                    {responseStatus}
                  </Badge>
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    {responseStatus >= 200 && responseStatus < 300
                      ? "Success"
                      : "Error"}
                  </span>
                </div>
              )}

              {response && (
                <div>
                  <Label>Response</Label>
                  <div className="mt-2">
                    <CodeBlock
                      code={response}
                      language="json"
                      showCopyButton={true}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="examples" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Code className="w-5 h-5" />
                Code Examples
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="flex items-center gap-2">
                  <Terminal className="w-4 h-4" />
                  cURL Example
                </Label>
                <div className="mt-2">
                  <CodeBlock
                    code={apiInfo.curl_example}
                    language="bash"
                    showCopyButton={true}
                  />
                </div>
              </div>

              <Separator />

              <div>
                <Label className="flex items-center gap-2">
                  <Code className="w-4 h-4" />
                  JavaScript Example
                </Label>
                <div className="mt-2">
                  <CodeBlock
                    code={`const response = await fetch("${apiInfo.api_url}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${apiInfo.jwt_token}",
    "Content-Type": "application/json"
  },
  body: JSON.stringify(${JSON.stringify(apiInfo.example_payload, null, 2)})
});

const result = await response.text();
console.log(result);`}
                    language="javascript"
                    showCopyButton={true}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
