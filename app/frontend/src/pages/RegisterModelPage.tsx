// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import RegisterModelForm from "../components/models/RegisterModelForm";
import ElevatedCard from "../components/ui/elevated-card";
import { useModels } from "../hooks/useModels";

export default function RegisterModelPage() {
  const navigate = useNavigate();
  const { refreshModels } = useModels();

  // After a successful registration, refresh the model list and return to it.
  const handleSuccess = useCallback(() => {
    refreshModels();
    navigate("/models-deployed");
  }, [refreshModels, navigate]);

  return (
    <div className="w-full flex justify-center px-4 py-6">
      <div className="w-full max-w-2xl">
        <ElevatedCard accent="neutral" depth="lg" className="py-6 px-6 md:px-8 space-y-5">
          <div>
            <h1 className="text-2xl font-semibold text-stone-100">
              Register External Model
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Connect a running Docker container to TT Studio. Pick a container —
              its model and devices are detected automatically.
            </p>
          </div>
          <RegisterModelForm onSuccess={handleSuccess} />
        </ElevatedCard>
      </div>
    </div>
  );
}
