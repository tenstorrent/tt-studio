import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Label } from "../../ui/label";
import { Separator } from "../../ui/separator";
import {
  Copy,
  FileText,
  Key,
  Globe,
  MessageSquare,
  Heart,
  Info,
} from "lucide-react";
import { APIInfo } from "../useModelAPIInfo";

interface EndpointsTabProps {
  apiInfo: APIInfo;
  copyToClipboard: (text: string, label: string) => void;
  getHfModelId: () => string;
}

export const EndpointsTab: React.FC<EndpointsTabProps> = ({
  apiInfo,
  copyToClipboard,
  getHfModelId,
}) => (
  <Card className="border border-gray-700 shadow-sm bg-gray-800">
    <CardHeader className="bg-gray-700 border-b border-gray-600">
      <CardTitle className="flex items-center gap-2 text-white">
        <Globe className="w-5 h-5 text-blue-400" />
        API Endpoint Information
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-4 p-6">
      <div className="grid grid-cols-1 gap-4">
        <div>
          <Label className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Chat Completions Endpoint
          </Label>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 p-3 bg-gray-900 border border-gray-600 rounded-md text-sm font-mono text-gray-200">
              {apiInfo.endpoints.chat_completions}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                copyToClipboard(
                  apiInfo.endpoints.chat_completions,
                  "Chat Completions Endpoint"
                )
              }
              className="border-gray-600 hover:bg-gray-700 text-white"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            OpenAI-compatible chat completions API endpoint
          </p>
        </div>

        <div>
          <Label className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Completions Endpoint
          </Label>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 p-3 bg-gray-900 border border-gray-600 rounded-md text-sm font-mono text-gray-200">
              {apiInfo.endpoints.completions}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                copyToClipboard(
                  apiInfo.endpoints.completions,
                  "Completions Endpoint"
                )
              }
              className="border-gray-600 hover:bg-gray-700 text-white"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            OpenAI-compatible completions API endpoint
          </p>
        </div>

        <div>
          <Label className="flex items-center gap-2">
            <Heart className="w-4 h-4" />
            Health Endpoint
          </Label>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 p-3 bg-gray-900 border border-gray-600 rounded-md text-sm font-mono text-gray-200">
              {apiInfo.endpoints.health}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                copyToClipboard(apiInfo.endpoints.health, "Health Endpoint")
              }
              className="border-gray-600 hover:bg-gray-700 text-white"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Model health check endpoint
          </p>
        </div>

        <div>
          <Label className="flex items-center gap-2">
            <Key className="w-4 h-4" />
            Authentication Token
          </Label>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 p-3 bg-gray-900 border border-gray-600 rounded-md text-sm font-mono text-gray-200">
              Bearer {apiInfo.jwt_token.substring(0, 20)}...
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                copyToClipboard(`Bearer ${apiInfo.jwt_token}`, "JWT Token")
              }
              className="border-gray-600 hover:bg-gray-700 text-white"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Authentication token for API requests (click Copy for full token)
          </p>
        </div>

        <div>
          <Label className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            HF Model ID
          </Label>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 p-3 bg-gray-900 border border-gray-600 rounded-md text-sm font-mono text-gray-200 overflow-auto">
              {getHfModelId()}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(getHfModelId(), "HF Model ID")}
              className="border-gray-600 hover:bg-gray-700 text-white"
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Hugging Face model identifier
          </p>
        </div>
      </div>

      <Separator />

      <div>
        <Label className="flex items-center gap-2">
          <Info className="w-4 h-4" />
          Model Information
        </Label>
        <div className="mt-2 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Model Name:
            </span>
            <div className="flex items-center gap-2">
              <span className="font-medium">{apiInfo.model_name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() =>
                  copyToClipboard(apiInfo.model_name, "Model Name")
                }
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Model Type:
            </span>
            <div className="flex items-center gap-2">
              <Badge
                variant="default"
                className="text-xs px-2 py-1 rounded-md font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
              >
                {apiInfo.model_type}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() =>
                  copyToClipboard(apiInfo.model_type, "Model Type")
                }
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
); 