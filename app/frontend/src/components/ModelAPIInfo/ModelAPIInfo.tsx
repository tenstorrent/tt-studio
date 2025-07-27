// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import { XCircle } from "lucide-react";
import { useModelAPIInfo, ModelAPIInfoProps } from "./useModelAPIInfo";
import { EndpointsTab, TestTab, ExamplesTab } from "./tabs";

export const ModelAPIInfo: React.FC<ModelAPIInfoProps> = ({
  modelId,
  modelName,
  onClose,
}) => {
  const {
    apiInfo,
    loading,
    testLoading,
    requestPayload,
    response,
    responseStatus,
    isDirectModelTest,
    setRequestPayload,
    handleTestAPI,
    copyToClipboard,
    getHfModelId,
    resetToExample,
    switchToBackendAPI,
    switchToDirectModel,
  } = useModelAPIInfo(modelId, modelName);

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
    <Card className="border border-gray-700 shadow-lg rounded-lg bg-black">
      <CardHeader className="pb-4 border-b border-gray-700 bg-gray-900 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl text-white">
              API Information: {modelName}
            </CardTitle>
            <p className="text-gray-300">
              Access OpenAI-compatible API endpoints for this model
            </p>
          </div>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-gray-600 hover:bg-gray-800 text-white"
          >
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6 bg-black">
        <div className="space-y-6">
          <Tabs defaultValue="endpoints" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3 bg-gray-800 border border-gray-700 rounded-lg p-1">
              <TabsTrigger
                value="endpoints"
                className="flex items-center gap-2 data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded-md transition-all text-white"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9"
                  />
                </svg>
                Endpoints
              </TabsTrigger>
              <TabsTrigger
                value="test"
                className="flex items-center gap-2 data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded-md transition-all text-white"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-6 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Test API
              </TabsTrigger>
              <TabsTrigger
                value="examples"
                className="flex items-center gap-2 data-[state=active]:bg-gray-700 data-[state=active]:shadow-sm rounded-md transition-all text-white"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                  />
                </svg>
                Examples
              </TabsTrigger>
            </TabsList>

            <TabsContent value="endpoints" className="space-y-4">
              <EndpointsTab
                apiInfo={apiInfo}
                copyToClipboard={copyToClipboard}
                getHfModelId={getHfModelId}
              />
            </TabsContent>

            <TabsContent value="test" className="space-y-4">
              <TestTab
                apiInfo={apiInfo}
                testLoading={testLoading}
                requestPayload={requestPayload}
                response={response}
                responseStatus={responseStatus}
                isDirectModelTest={isDirectModelTest}
                getHfModelId={getHfModelId}
                setRequestPayload={setRequestPayload}
                handleTestAPI={handleTestAPI}
                copyToClipboard={copyToClipboard}
                resetToExample={resetToExample}
                switchToBackendAPI={switchToBackendAPI}
                switchToDirectModel={switchToDirectModel}
              />
            </TabsContent>

            <TabsContent value="examples" className="space-y-4">
              <ExamplesTab
                apiInfo={apiInfo}
                getHfModelId={getHfModelId}
                copyToClipboard={copyToClipboard}
              />
            </TabsContent>
          </Tabs>
        </div>
      </CardContent>
    </Card>
  );
}; 