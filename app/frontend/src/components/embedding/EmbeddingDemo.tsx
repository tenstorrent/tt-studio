// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card } from "../ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  fetchEmbeddingModels,
  type DeployedEmbeddingModel,
} from "../../api/modelsDeployedApis";
import DocumentsPanel from "./DocumentsPanel";

export default function EmbeddingDemo() {
  const [models, setModels] = useState<DeployedEmbeddingModel[]>([]);
  const [selectedDeployId, setSelectedDeployId] = useState("");

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
              Embeddings
            </h1>
            <p className="mt-2 text-base text-gray-600 dark:text-gray-300">
              Upload and search documents using a deployed embedding model.
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

          {/* Upload, browse, and search a document collection. */}
          {modelIdentifier && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
            >
              <DocumentsPanel modelIdentifier={modelIdentifier} />
            </motion.div>
          )}
        </div>
      </div>
    </Card>
  );
}
