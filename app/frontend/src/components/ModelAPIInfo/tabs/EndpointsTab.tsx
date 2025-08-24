import React from "react";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Label } from "../../ui/label";
import { Copy, FileText, Key, Globe, MessageSquare, Heart } from "lucide-react";
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
  <div className="bg-black border border-zinc-800">
    <div className="w-full mx-auto px-2 sm:px-4 lg:px-6">
      <div className="py-6">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2 font-tt_a_mono">
            <Globe className="w-5 h-5 text-TT-purple" />
            API Endpoint Information
          </h2>
          <div className="flex items-center gap-4 mt-2">
            <span className="text-sm text-zinc-500">Model:</span>
            <span className="text-sm font-medium text-white font-tt_a_mono">
              {apiInfo.model_name}
            </span>
            <Badge className="bg-TT-purple text-white text-xs px-2 py-1 rounded-md font-tt_a_mono">
              {apiInfo.model_type}
            </Badge>
            <span className="text-xs text-zinc-500">
              Ready for API requests
            </span>
          </div>
        </div>

        {/* Endpoint Grid */}
        <div className="space-y-4">
          {/* Chat Completions Endpoint */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
            <Label className="flex items-center gap-2 text-sm font-medium text-white mb-3 font-tt_a_mono">
              <MessageSquare className="w-4 h-4 text-TT-purple" />
              Chat Completions Endpoint
            </Label>
            <div className="group flex items-center gap-3 p-3 bg-zinc-800 border border-zinc-600 rounded-md hover:bg-zinc-750 transition-colors">
              <div className="bg-blue-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                POST
              </div>
              <code className="flex-1 text-sm font-mono text-zinc-300">
                {apiInfo.endpoints.chat_completions}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  copyToClipboard(
                    apiInfo.endpoints.chat_completions,
                    "Chat Completions Endpoint"
                  )
                }
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-white hover:bg-zinc-700"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              OpenAI-compatible chat completions API endpoint
            </p>
          </div>

          {/* Completions Endpoint */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
            <Label className="flex items-center gap-2 text-sm font-medium text-white mb-3 font-tt_a_mono">
              <FileText className="w-4 h-4 text-TT-purple" />
              Completions Endpoint
            </Label>
            <div className="group flex items-center gap-3 p-3 bg-zinc-800 border border-zinc-600 rounded-md hover:bg-zinc-750 transition-colors">
              <div className="bg-blue-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                POST
              </div>
              <code className="flex-1 text-sm font-mono text-zinc-300">
                {apiInfo.endpoints.completions}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  copyToClipboard(
                    apiInfo.endpoints.completions,
                    "Completions Endpoint"
                  )
                }
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-white hover:bg-zinc-700"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              OpenAI-compatible completions API endpoint
            </p>
          </div>

          {/* Health Endpoint */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
            <Label className="flex items-center gap-2 text-sm font-medium text-white mb-3 font-tt_a_mono">
              <Heart className="w-4 h-4 text-TT-purple" />
              Health Endpoint
            </Label>
            <div className="group flex items-center gap-3 p-3 bg-zinc-800 border border-zinc-600 rounded-md hover:bg-zinc-750 transition-colors">
              <div className="bg-green-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                GET
              </div>
              <code className="flex-1 text-sm font-mono text-zinc-300">
                {apiInfo.endpoints.health}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  copyToClipboard(apiInfo.endpoints.health, "Health Endpoint")
                }
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-white hover:bg-zinc-700"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Model health check endpoint
            </p>
          </div>

          {/* Authentication Token */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
            <Label className="flex items-center gap-2 text-sm font-medium text-white mb-3 font-tt_a_mono">
              <Key className="w-4 h-4 text-TT-purple" />
              Authentication Token
            </Label>
            <div className="group flex items-center gap-3 p-3 bg-zinc-800 border border-zinc-600 rounded-md hover:bg-zinc-750 transition-colors">
              <div className="bg-purple-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                Bearer
              </div>
              <code className="flex-1 text-sm font-mono text-zinc-300">
                {apiInfo.jwt_token.substring(0, 20)}...
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  copyToClipboard(`Bearer ${apiInfo.jwt_token}`, "JWT Token")
                }
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-white hover:bg-zinc-700"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Authentication token for API requests (click Copy for full token)
            </p>
          </div>

          {/* HF Model ID */}
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4">
            <Label className="flex items-center gap-2 text-sm font-medium text-white mb-3 font-tt_a_mono">
              <FileText className="w-4 h-4 text-TT-purple" />
              HF Model ID
            </Label>
            <div className="group flex items-center gap-3 p-3 bg-zinc-800 border border-zinc-600 rounded-md hover:bg-zinc-750 transition-colors">
              <div className="bg-gray-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
                ID
              </div>
              <code className="flex-1 text-sm font-mono text-zinc-300">
                {getHfModelId()}
              </code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(getHfModelId(), "HF Model ID")}
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-white hover:bg-zinc-700"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Hugging Face model identifier
            </p>
          </div>
        </div>

        {/* Footer Description */}
        <div className="mt-6 pt-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-600 text-center">
            Complete API endpoint information and authentication details
          </p>
        </div>
      </div>
    </div>
  </div>
);
