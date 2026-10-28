// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from "react";
import FaceRecognitionComponent from "../components/face_recognition/FaceRecognitionComponent";
import { ModelToolbar } from "@/src/vesper/components/model-toolbar";
import { useHealthyModels } from "@/src/vesper/hooks/use-healthy-models";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: "" };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message + "\n" + error.stack };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 bg-red-100 text-red-800 m-4 rounded">
          <h2 className="font-bold text-xl mb-2">Error in Face Recognition</h2>
          <pre className="text-sm whitespace-pre-wrap">{this.state.error}</pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 bg-red-600 text-white px-4 py-2 rounded"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const FaceRecognitionPage = () => {
  const { models, isLoading, selected, setSelectedId } =
    useHealthyModels("face_recognition");

  return (
    <div className="h-full flex flex-col">
      <ModelToolbar
        models={models}
        isLoading={isLoading}
        value={selected?.id ?? null}
        onChange={setSelectedId}
        emptyText="No face recognition model is ready."
      />
      <ErrorBoundary>
        <div className="flex-1 min-h-0 w-full overflow-hidden flex justify-center p-2 sm:p-3 lg:p-4">
          <FaceRecognitionComponent modelID={selected?.id ?? null} />
        </div>
      </ErrorBoundary>
    </div>
  );
};

export default FaceRecognitionPage;
