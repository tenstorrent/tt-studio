// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Alert, AlertDescription } from "../ui/alert";
import { Spinner } from "../ui/spinner";
import { XCircle } from "lucide-react";
import { useModelAPIInfo, ModelAPIInfoProps } from "./useModelAPIInfo";
import { EndpointsTab, TestTab, ExamplesTab } from "./tabs";
import { ArrowLeft } from "lucide-react";

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
    <Card className="h-auto py-4 px-4 md:px-6 lg:px-8 border-2 w-full max-w-7xl">
      <CardHeader className="pb-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={onClose}
            className="flex items-center gap-2 p-0 h-auto text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Models
          </Button>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-white"
          >
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="space-y-6">
          <Tabs defaultValue="endpoints" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3 bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
              <TabsTrigger
                value="endpoints"
                className="flex items-center gap-2 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm rounded-md transition-all text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white data-[state=active]:text-gray-900 dark:data-[state=active]:text-white"
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
                className="flex items-center gap-2 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm rounded-md transition-all text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white data-[state=active]:text-gray-900 dark:data-[state=active]:text-white"
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
                className="flex items-center gap-2 data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm rounded-md transition-all text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white data-[state=active]:text-gray-900 dark:data-[state=active]:text-white"
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
                modelId={modelId}
                modelName={modelName}
              />
            </TabsContent>
          </Tabs>
        </div>
      </CardContent>
    </Card>
  );
};
