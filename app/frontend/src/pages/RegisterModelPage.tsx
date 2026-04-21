// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useRef, useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import RegisterModelFormContent from "../components/models/RegisterModelFormContent";
import DeleteModelDialog from "../components/models/DeleteModelDialog";
import { Button } from "../components/ui/button";
import { ElevatedCard } from "../components/ui/elevated-card";
import { useModels } from "../hooks/useModels";
import { useDeleteStream } from "../hooks/useDeleteStream";
import { useRefresh } from "../hooks/useRefresh";
import type { Model } from "../contexts/ModelsContext";

function HealthDot({ health }: { health: unknown }) {
  const healthStr = typeof health === "string" ? health : "unknown";
  const isHealthy = healthStr === "healthy";
  const isUnhealthy = healthStr === "unhealthy";
  const dotColor = isHealthy
    ? "bg-green-500"
    : isUnhealthy
    ? "bg-red-500"
    : "bg-yellow-500";
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${isHealthy ? "animate-pulse" : ""}`}
      />
      <span className="text-sm text-stone-300">{healthStr}</span>
    </div>
  );
}

function DeployedModelsTable({
  models,
  onDeleteClick,
}: {
  models: Model[];
  onDeleteClick: (id: string) => void;
}) {
  if (models.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No models currently running.
      </p>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 text-left text-xs text-muted-foreground uppercase tracking-wider">
            <th className="pb-2 pr-4 font-medium">Model Name</th>
            <th className="pb-2 pr-4 font-medium">Type</th>
            <th className="pb-2 pr-4 font-medium">Health</th>
            <th className="pb-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/60">
          {models.map((model) => (
            <tr key={model.id} className="group">
              <td className="py-3 pr-4 font-medium text-stone-200">
                {model.name}
              </td>
              <td className="py-3 pr-4 text-stone-400 capitalize">
                {model.model_type?.replace(/_/g, " ") ?? "—"}
              </td>
              <td className="py-3 pr-4">
                <HealthDot health={model.health} />
              </td>
              <td className="py-3 text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-400 hover:text-red-300 hover:bg-red-950/30 gap-1.5"
                  onClick={() => onDeleteClick(model.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RegisterModelPage() {
  const { models, refreshModels } = useModels();
  const { triggerHardwareRefresh } = useRefresh();
  const deleteStream = useDeleteStream();

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const modelsRef = useRef<HTMLDivElement>(null);

  const handleRegistrationSuccess = useCallback(async () => {
    await refreshModels();
    // Scroll to models section after a short delay to let the DOM update
    window.setTimeout(() => {
      modelsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
  }, [refreshModels]);

  const handleDeleteClick = useCallback((id: string) => {
    setDeleteTargetId(id);
    setShowDeleteModal(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTargetId) return;
    deleteStream.start(deleteTargetId);
  }, [deleteTargetId, deleteStream]);

  const handleCloseDeleteModal = useCallback(() => {
    if (deleteStream.status === "running") return;

    const finished =
      deleteStream.status === "success" ||
      deleteStream.status === "partial" ||
      deleteStream.status === "error";

    if (finished) {
      if (
        deleteStream.status === "success" ||
        deleteStream.status === "partial"
      ) {
        localStorage.setItem("hasEverDeployed", "true");
      }
      refreshModels();
      triggerHardwareRefresh();
    }

    setShowDeleteModal(false);
    setDeleteTargetId(null);
    deleteStream.reset();
  }, [deleteStream, refreshModels, triggerHardwareRefresh]);

  // Auto-close delete dialog on success
  const autoCloseTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (deleteStream.status === "success" && showDeleteModal) {
      localStorage.setItem("hasEverDeployed", "true");
      autoCloseTimerRef.current = window.setTimeout(() => {
        handleCloseDeleteModal();
      }, 1500);
    }
    return () => {
      if (autoCloseTimerRef.current !== null) {
        clearTimeout(autoCloseTimerRef.current);
      }
    };
  }, [deleteStream.status, showDeleteModal, handleCloseDeleteModal]);

  return (
    <div className="w-full flex justify-center px-4 py-6">
      <div className="w-full max-w-3xl">
        <ElevatedCard accent="neutral" depth="lg" className="py-6 px-6 md:px-10 space-y-5">
          {/* Header */}
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-stone-100">
              Register a Model
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Connect an externally running Docker container to TT Studio.
            </p>
          </div>

          {/* Registration form */}
          <RegisterModelFormContent onSuccess={handleRegistrationSuccess} />

          {/* Divider */}
          <div className="border-t border-stone-800" />

          {/* Deployed models section */}
          <div ref={modelsRef}>
            <h2 className="text-lg font-semibold text-stone-100 mb-4">
              Deployed Models
            </h2>
            <DeployedModelsTable
              models={models}
              onDeleteClick={handleDeleteClick}
            />
          </div>
        </ElevatedCard>
      </div>

      {/* Delete dialog — reuses the full deletion flow with SSE streaming */}
      <DeleteModelDialog
        open={showDeleteModal}
        modelId={deleteTargetId ?? ""}
        isLoading={deleteStream.status === "running"}
        deleteStep={deleteStream.step}
        streamStatus={deleteStream.status}
        stepLogs={deleteStream.stepLogs}
        errorMessage={deleteStream.errorMessage}
        onConfirm={handleConfirmDelete}
        onCancel={handleCloseDeleteModal}
      />
    </div>
  );
}
