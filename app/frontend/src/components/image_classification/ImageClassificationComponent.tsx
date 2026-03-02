// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useCallback, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Card } from "../ui/card";
import { customToast } from "../CustomToaster";
import { Upload, ImageIcon, Loader2, ScanSearch, BarChart3 } from "lucide-react";

interface ClassificationResult {
  label: string;
  probability: string;
  index: number;
}

interface ClassificationResponse {
  image_data: Array<{
    top1_class_label: string;
    top1_class_probability: string;
    output: {
      labels: string[];
      probabilities: string[];
      indices: number[];
    };
  }>;
}

export const ImageClassificationComponent: React.FC = () => {
  const location = useLocation();
  const [modelID] = useState<string | null>(
    location.state?.containerID || null
  );
  const [modelName] = useState<string>(
    location.state?.modelName || "Forge CNN Model"
  );
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [results, setResults] = useState<ClassificationResult[]>([]);
  const [topLabel, setTopLabel] = useState<string>("");
  const [topProbability, setTopProbability] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [inferenceTime, setInferenceTime] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        customToast.error("Please select an image file");
        return;
      }

      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setSelectedImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);
      setResults([]);
      setTopLabel("");
      setTopProbability("");
      setInferenceTime(null);
    },
    []
  );

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      customToast.error("Please drop an image file");
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setSelectedImage(e.target?.result as string);
    };
    reader.readAsDataURL(file);
    setResults([]);
    setTopLabel("");
    setTopProbability("");
    setInferenceTime(null);
  }, []);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
    },
    []
  );

  const handleClassify = useCallback(async () => {
    if (!selectedFile || !modelID) {
      if (!modelID) {
        customToast.error(
          "No model container found. Deploy a forge model first."
        );
      }
      return;
    }

    setIsLoading(true);
    const startTime = performance.now();

    try {
      const formData = new FormData();
      formData.append("deploy_id", modelID);
      formData.append("image", selectedFile);
      formData.append("top_k", "5");
      formData.append("min_confidence", "1.0");
      formData.append("response_format", "json");

      const response = await fetch("/models-api/image-classification/", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Classification failed: ${response.statusText}`);
      }

      const data: ClassificationResponse = await response.json();
      const elapsed = performance.now() - startTime;
      setInferenceTime(Math.round(elapsed));

      if (data.image_data && data.image_data.length > 0) {
        const result = data.image_data[0];
        setTopLabel(result.top1_class_label);
        setTopProbability(result.top1_class_probability);

        const predictions: ClassificationResult[] =
          result.output.labels.map((label, i) => ({
            label,
            probability: result.output.probabilities[i],
            index: result.output.indices[i],
          }));
        setResults(predictions);
      }
    } catch (error) {
      console.error("Classification error:", error);
      customToast.error(
        `Classification failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedFile, modelID]);

  const getProbabilityWidth = (prob: string): number => {
    const val = parseFloat(prob.replace("%", ""));
    return isNaN(val) ? 0 : Math.min(val, 100);
  };

  return (
    <div className="w-full h-full flex flex-col gap-6 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ScanSearch className="w-8 h-8 text-TT-purple-accent" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Image Classification
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {modelName} — Powered by TT-Forge on Tenstorrent hardware
          </p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
        {/* Left: Image Upload */}
        <Card className="flex flex-col p-6 overflow-hidden">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-800 dark:text-gray-200">
            <ImageIcon className="w-5 h-5" />
            Input Image
          </h2>

          <div
            className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center cursor-pointer transition-colors min-h-[300px] ${
              selectedImage
                ? "border-TT-purple-accent/50 dark:border-TT-purple-accent/70"
                : "border-gray-300 dark:border-gray-600 hover:border-TT-purple-accent/70 dark:hover:border-TT-purple-accent"
            }`}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            {selectedImage ? (
              <img
                src={selectedImage}
                alt="Selected"
                className="max-h-full max-w-full object-contain rounded-lg"
              />
            ) : (
              <div className="text-center p-8">
                <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-600 dark:text-gray-400 font-medium">
                  Drop an image here or click to upload
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                  Supports JPEG, PNG, WebP
                </p>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />

          <button
            onClick={handleClassify}
            disabled={!selectedImage || isLoading || !modelID}
            className="mt-4 w-full py-3 px-4 bg-TT-purple-accent hover:bg-TT-purple-accent/90 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Classifying...
              </>
            ) : (
              <>
                <ScanSearch className="w-5 h-5" />
                Classify Image
              </>
            )}
          </button>
        </Card>

        {/* Right: Results */}
        <Card className="flex flex-col p-6 overflow-hidden">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-800 dark:text-gray-200">
            <BarChart3 className="w-5 h-5" />
            Classification Results
            {inferenceTime !== null && (
              <span className="ml-auto text-sm font-normal text-gray-500">
                {inferenceTime}ms
              </span>
            )}
          </h2>

          {results.length > 0 ? (
            <div className="flex-1 flex flex-col gap-4 overflow-auto">
              {/* Top prediction */}
              <div className="bg-TT-purple-accent/10 border border-TT-purple-accent/40 rounded-xl p-5">
                <p className="text-sm text-TT-purple-accent font-medium mb-1">
                  Top Prediction
                </p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {topLabel}
                </p>
                <p className="text-lg text-TT-purple-accent font-semibold">
                  {topProbability}
                </p>
              </div>

              {/* All predictions */}
              <div className="flex flex-col gap-3">
                {results.map((result, idx) => (
                  <div
                    key={idx}
                    className="relative bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3"
                  >
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="font-medium text-gray-800 dark:text-gray-200 text-sm truncate mr-4">
                        {result.label}
                      </span>
                      <span className="text-sm font-mono text-gray-600 dark:text-gray-400 shrink-0">
                        {result.probability}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-TT-purple-accent h-2 rounded-full transition-all duration-500"
                        style={{
                          width: `${getProbabilityWidth(result.probability)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <ScanSearch className="w-16 h-16 mx-auto mb-4 text-TT-purple-accent/40 dark:text-TT-purple-accent/50" />
                <p className="text-gray-500 dark:text-gray-400">
                  {isLoading
                    ? "Running inference on Tenstorrent hardware..."
                    : "Upload an image and click Classify to see results"}
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
