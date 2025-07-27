// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { ArrowLeft } from "lucide-react";
import { ModelAPIInfo } from "../components/ModelAPIInfo";
import { Spinner } from "../components/ui/spinner";
import { Alert, AlertDescription } from "../components/ui/alert";
import { XCircle } from "lucide-react";

const ApiInfoPage = () => {
  const { modelId: encodedModelId } = useParams<{ modelId: string }>();
  const navigate = useNavigate();
  const [modelName, setModelName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Decode the modelId from the URL
  const modelId = encodedModelId ? decodeURIComponent(encodedModelId) : null;

  useEffect(() => {
    const fetchModelName = async () => {
      console.log("ApiInfoPage: Fetching model data for modelId:", modelId);
      console.log(
        "ApiInfoPage: Original encoded modelId from URL:",
        encodedModelId
      );

      if (!modelId) {
        console.error("ApiInfoPage: No modelId provided in URL params");
        setError("No model ID provided");
        setLoading(false);
        return;
      }

      try {
        console.log("ApiInfoPage: Making API request to /models-api/deployed/");
        const response = await fetch("/models-api/deployed/");

        if (!response.ok) {
          console.error(
            `ApiInfoPage: API request failed with status ${response.status}`
          );
          throw new Error(`Failed to fetch model data: ${response.status}`);
        }

        const data = await response.json();
        console.log("ApiInfoPage: API response data:", data);
        console.log("ApiInfoPage: Looking for model with ID:", modelId);

        const model = data[modelId];
        console.log("ApiInfoPage: Found model:", model);

        if (!model) {
          console.error(
            `ApiInfoPage: Model with ID ${modelId} not found in API response`
          );
          throw new Error(`Model with ID ${modelId} not found`);
        }

        // Check if model_impl exists and has model_name property
        if (!model.model_impl || typeof model.model_impl !== "object") {
          console.error(
            "ApiInfoPage: model_impl is missing or not an object:",
            model.model_impl
          );
          throw new Error("Invalid model data: model_impl is missing");
        }

        const modelNameValue = model.model_impl.model_name || "Unknown Model";
        console.log("ApiInfoPage: Setting model name to:", modelNameValue);
        setModelName(modelNameValue);
      } catch (error) {
        console.error("ApiInfoPage: Error fetching model name:", error);
        setError(
          error instanceof Error ? error.message : "Failed to fetch model data"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchModelName();
  }, [modelId, encodedModelId]);

  const handleBack = () => {
    navigate(-1);
  };

  // Log render state
  console.log("ApiInfoPage render state:", {
    encodedModelId,
    modelId,
    modelName,
    loading,
    error,
  });

  return (
    <div className="h-screen flex-1 w-full dark:bg-black bg-white dark:bg-dot-white/[0.2] bg-dot-black/[0.2] relative">
      {/* Radial gradient for the container to give a faded look */}
      <div
        className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
        style={{
          maskImage:
            "radial-gradient(ellipse at center, transparent 65%, black 100%)",
        }}
      ></div>
      <div className="flex flex-col h-screen w-full md:px-20 pt-12 pb-28 overflow-auto">
        <Card className="border-0 shadow-none">
          <CardContent className="p-6">
            <Button
              variant="ghost"
              onClick={handleBack}
              className="mb-4 flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Models
            </Button>

            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Spinner className="w-8 h-8" />
                <span className="ml-2">Loading API information...</span>
              </div>
            ) : error ? (
              <Alert className="bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800">
                <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <AlertDescription className="text-red-800 dark:text-red-200">
                  {error}
                </AlertDescription>
              </Alert>
            ) : (
              modelId && (
                <ModelAPIInfo
                  modelId={modelId}
                  modelName={modelName}
                  onClose={handleBack}
                />
              )
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ApiInfoPage;
