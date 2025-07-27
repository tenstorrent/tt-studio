import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Label } from "../../ui/label";
import { Alert, AlertDescription } from "../../ui/alert";
import { Spinner } from "../../ui/spinner";
import { Textarea } from "../../ui/textarea";
import CodeBlock from "../../chatui/CodeBlock";
import {
  Copy,
  Terminal,
  Play,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { APIInfo } from "../useModelAPIInfo";

interface TestTabProps {
  apiInfo: APIInfo;
  testLoading: boolean;
  requestPayload: string;
  response: string;
  responseStatus: number | null;
  isDirectModelTest: boolean;
  getHfModelId: () => string;
  setRequestPayload: (payload: string) => void;
  handleTestAPI: () => void;
  copyToClipboard: (text: string, label: string) => void;
  resetToExample: () => void;
  switchToBackendAPI: () => void;
  switchToDirectModel: () => void;
}

export const TestTab: React.FC<TestTabProps> = ({
  apiInfo,
  testLoading,
  requestPayload,
  response,
  responseStatus,
  isDirectModelTest,
  getHfModelId,
  setRequestPayload,
  handleTestAPI,
  copyToClipboard,
  resetToExample,
  switchToBackendAPI,
  switchToDirectModel,
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Terminal className="w-5 h-5" />
        API Test Console
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      <Alert className="bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 mb-4">
        <AlertDescription className="text-blue-800 dark:text-blue-200">
          <strong>Testing Tips:</strong> For direct model server testing, use
          the model's HF ID:{" "}
          <code className="bg-blue-100 dark:bg-blue-800 px-1 py-0.5 rounded">
            {getHfModelId()}
          </code>
        </AlertDescription>
      </Alert>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium">Test Mode:</span>
        <div className="flex border rounded-md overflow-hidden">
          <button
            className={`px-3 py-1.5 text-sm ${
              !isDirectModelTest
                ? "bg-blue-500 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            }`}
            onClick={switchToBackendAPI}
          >
            Backend API
          </button>
          <button
            className={`px-3 py-1.5 text-sm ${
              isDirectModelTest
                ? "bg-blue-500 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            }`}
            onClick={switchToDirectModel}
          >
            Direct Model Server
          </button>
        </div>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
        <div className="text-sm font-medium mb-1">Current Endpoint:</div>
        <code className="text-xs text-gray-600 dark:text-gray-300">
          {isDirectModelTest
            ? apiInfo.endpoints.chat_completions
            : apiInfo.endpoints.tt_studio_backend}
        </code>
        <div className="text-xs text-gray-500 mt-1">
          {isDirectModelTest
            ? "Direct vLLM server endpoint (OpenAI-compatible)"
            : "TT Studio backend proxy endpoint"}
        </div>
      </div>

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
        <Button variant="outline" onClick={resetToExample}>
          Reset to Example
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">Authentication:</Label>
        <code className="p-1 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono flex-1">
          Bearer {apiInfo.jwt_token.substring(0, 20)}...
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            copyToClipboard(`Bearer ${apiInfo.jwt_token}`, "JWT Token")
          }
          className="h-7"
        >
          <Copy className="w-3 h-3 mr-1" />
          Copy
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
            className={`flex items-center gap-1 px-2 py-1 ${
              responseStatus >= 200 && responseStatus < 300
                ? "bg-green-500 hover:bg-green-600"
                : "bg-red-500 hover:bg-red-600"
            }`}
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
            <CodeBlock code={response} language="json" showCopyButton={true} />
          </div>
        </div>
      )}
    </CardContent>
  </Card>
); 