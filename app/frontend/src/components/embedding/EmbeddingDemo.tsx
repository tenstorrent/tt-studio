// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from "react";
import { Binary, Copy, Loader2, GitCompareArrows } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Card } from "../ui/card";
import { Progress } from "../ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { runEmbeddingInference } from "../../api/modelsDeployedApis";
import { customToast } from "../CustomToaster";
import DocumentsPanel from "./DocumentsPanel";

interface DeployedModelInfo {
  id: string;
  modelName: string;
  hfModelId?: string;
  model_type?: string;
}

async function fetchEmbeddingModels(): Promise<DeployedModelInfo[]> {
  try {
    const res = await fetch("/models-api/deployed/");
    if (!res.ok) return [];
    const data = await res.json();
    return Object.entries(data)
      .map(([id, info]: [string, any]) => ({
        id,
        modelName:
          info.model_impl?.model_name ||
          info.model_impl?.hf_model_id ||
          "Unknown",
        hfModelId: info.model_impl?.hf_model_id,
        model_type: info.model_impl?.model_type,
      }))
      .filter((m) => m.model_type === "embedding");
  } catch {
    return [];
  }
}

// Standard cosine similarity between two equal-length embedding vectors.
function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

type Mode = "single" | "compare" | "documents";

export default function EmbeddingDemo() {
  const [models, setModels] = useState<DeployedModelInfo[]>([]);
  const [selectedDeployId, setSelectedDeployId] = useState("");
  const [mode, setMode] = useState<Mode>("documents");
  const [textA, setTextA] = useState("");
  const [textB, setTextB] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [vectorA, setVectorA] = useState<number[] | null>(null);
  const [vectorB, setVectorB] = useState<number[] | null>(null);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedDeployId),
    [models, selectedDeployId]
  );
  // A Chroma collection is locked to one embedding function for life, so it has
  // to key on the model's stable identity, not this ephemeral deploy/container id.
  const modelIdentifier = selectedModel?.hfModelId || selectedModel?.modelName;

  useEffect(() => {
    fetchEmbeddingModels().then((found) => {
      setModels(found);
      if (found.length > 0) setSelectedDeployId(found[0].id);
    });
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setVectorA(null);
    setVectorB(null);
  };

  const handleGenerate = async () => {
    if (!selectedDeployId) {
      customToast.error("Please select an embedding model");
      return;
    }
    if (!textA.trim() || (mode === "compare" && !textB.trim())) {
      customToast.error("Please enter text to embed");
      return;
    }

    setIsLoading(true);
    setVectorA(null);
    setVectorB(null);
    try {
      if (mode === "single") {
        const result = await runEmbeddingInference(selectedDeployId, textA.trim());
        setVectorA(result.embedding);
      } else {
        const [resultA, resultB] = await Promise.all([
          runEmbeddingInference(selectedDeployId, textA.trim()),
          runEmbeddingInference(selectedDeployId, textB.trim()),
        ]);
        setVectorA(resultA.embedding);
        setVectorB(resultB.embedding);
      }
    } catch (err) {
      customToast.error(
        `Embedding generation failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyVector = (vector: number[]) => {
    navigator.clipboard.writeText(JSON.stringify(vector));
    customToast.success("Vector copied to clipboard!");
  };

  const similarity = vectorA && vectorB ? cosineSimilarity(vectorA, vectorB) : null;

  return (
    // Fixed height, not max-height: the outer page wrapper vertically centers
    // this card (items-center in a h-screen flex). A card that grows with its
    // content -- switching modes, search results appearing -- would grow
    // symmetrically around that centered point, pushing its top edge upward
    // until it goes behind the navbar. A constant footprint keeps the card's
    // position stable; content beyond it scrolls internally instead.
    <Card className="flex flex-col w-full max-w-3xl h-[85vh] overflow-hidden shadow-xl bg-white dark:bg-black border-gray-200 dark:border-[#7C68FA]/20 rounded-2xl">
      {/* items-start (not center): centering a flex item taller than its
          container defaults the scroll position to the middle, hiding the
          header above the visible area once content (e.g. search results)
          grows past the viewport. Top-anchoring keeps it reachable by
          scrolling down instead. */}
      <div className="flex-1 overflow-auto flex items-start justify-center">
        <div className="w-full max-w-3xl px-6 py-8 flex flex-col gap-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-center"
          >
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
              Embeddings Demo
            </h1>
            <p className="mt-2 text-base text-gray-600 dark:text-gray-300">
              Generate vector embeddings from text using a deployed embedding model.
            </p>
          </motion.div>

          {/* Model selector */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="flex flex-col gap-2"
          >
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Embedding Model
            </label>
            {models.length === 0 ? (
              <div className="text-sm text-amber-600 dark:text-amber-400 border-2 border-amber-400 dark:border-amber-600 rounded-lg px-4 py-3 bg-amber-50 dark:bg-amber-950">
                No embedding models are currently deployed. Deploy an embedding
                model to get started.
              </div>
            ) : (
              <Select value={selectedDeployId} onValueChange={setSelectedDeployId}>
                <SelectTrigger className="h-12 text-base border-2">
                  <SelectValue placeholder="Select embedding model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.modelName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </motion.div>

          {/* Mode toggle */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
            className="flex items-center gap-2"
          >
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Mode:
            </span>
            <div className="flex border-2 rounded-md overflow-hidden">
              <button
                className={`px-3 py-1.5 text-sm transition-colors ${
                  mode === "documents"
                    ? "bg-TT-purple-accent text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                }`}
                onClick={() => switchMode("documents")}
                disabled={isLoading}
              >
                Documents
              </button>
              <button
                className={`px-3 py-1.5 text-sm transition-colors ${
                  mode === "single"
                    ? "bg-TT-purple-accent text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                }`}
                onClick={() => switchMode("single")}
                disabled={isLoading}
              >
                Single Text
              </button>
              <button
                className={`px-3 py-1.5 text-sm transition-colors ${
                  mode === "compare"
                    ? "bg-TT-purple-accent text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                }`}
                onClick={() => switchMode("compare")}
                disabled={isLoading}
              >
                Compare Similarity
              </button>
            </div>
          </motion.div>

          {/* Documents mode: upload, browse, and search a collection instead of
              the single/compare text workflow below. */}
          {mode === "documents" && modelIdentifier && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
            >
              <DocumentsPanel modelIdentifier={modelIdentifier} />
            </motion.div>
          )}

          {/* Text input(s) */}
          {mode !== "documents" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                {mode === "compare" ? "Text A" : "Text to embed"}
              </label>
              <Textarea
                rows={4}
                placeholder="Enter text here…"
                value={textA}
                onChange={(e) => setTextA(e.target.value)}
                className="resize-none focus-visible:ring-2 focus-visible:ring-TT-purple-accent text-base border-2"
                disabled={isLoading}
              />
            </div>
            {mode === "compare" && (
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Text B
                </label>
                <Textarea
                  rows={4}
                  placeholder="Enter text here…"
                  value={textB}
                  onChange={(e) => setTextB(e.target.value)}
                  className="resize-none focus-visible:ring-2 focus-visible:ring-TT-purple-accent text-base border-2"
                  disabled={isLoading}
                />
              </div>
            )}
          </motion.div>
          )}

          {/* Generate button */}
          {mode !== "documents" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.3 }}
            className="flex justify-center"
          >
            <Button
              size="lg"
              className="flex items-center gap-2 px-12 h-14 text-lg bg-TT-purple-accent hover:bg-TT-purple text-white font-semibold transition-all duration-200 hover:shadow-xl hover:scale-105 disabled:hover:scale-100 disabled:hover:shadow-none"
              onClick={handleGenerate}
              disabled={
                isLoading ||
                models.length === 0 ||
                !textA.trim() ||
                (mode === "compare" && !textB.trim())
              }
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Generating…
                </>
              ) : mode === "compare" ? (
                <>
                  <GitCompareArrows className="w-6 h-6" />
                  Compare
                </>
              ) : (
                <>
                  <Binary className="w-6 h-6" />
                  Generate Embedding
                </>
              )}
            </Button>
          </motion.div>
          )}

          {/* Results */}
          {vectorA && mode === "single" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="rounded-xl overflow-hidden border border-[#7C68FA]/30 shadow-2xl p-4 flex flex-col gap-3"
              style={{ background: "#0D0D14" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-widest text-[#2EE8C4]">
                  {vectorA.length}-dimensional vector
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 text-gray-300 hover:text-white hover:bg-white/10"
                  onClick={() => handleCopyVector(vectorA)}
                >
                  <Copy className="w-3.5 h-3.5 mr-1" />
                  Copy Full Vector
                </Button>
              </div>
              <code className="text-xs font-mono text-gray-400 break-all">
                [{vectorA.slice(0, 8).map((v) => v.toFixed(4)).join(", ")}
                {vectorA.length > 8 ? ", …" : ""}]
              </code>
            </motion.div>
          )}

          {vectorA && vectorB && mode === "compare" && similarity !== null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
              className="rounded-xl overflow-hidden border border-[#7C68FA]/30 shadow-2xl p-4 flex flex-col gap-3"
              style={{ background: "#0D0D14" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-widest text-[#2EE8C4]">
                  Cosine Similarity
                </span>
                <span className="text-lg font-mono font-bold text-white">
                  {similarity.toFixed(4)}
                </span>
              </div>
              <Progress
                value={((similarity + 1) / 2) * 100}
                className="bg-white/10"
                indicatorClassName="bg-gradient-to-r from-[#7C68FA] to-[#2EE8C4]"
              />
              <span className="text-xs text-gray-500">
                −1 (opposite) · 0 (unrelated) · 1 (identical meaning)
              </span>
            </motion.div>
          )}
        </div>
      </div>
    </Card>
  );
}
