// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Typography } from "@tenstorrent/vesper/typography";
import { Success } from "@tenstorrent/vesper/icons";
import { addToast } from "@tenstorrent/vesper/toast";
import { updateSettings } from "@/src/api/settingsApi";
import { StepLayout } from "./step-layout";
import { usePrevStep } from "../utils";

export function FinishOnboarding() {
  const navigate = useNavigate();
  const prevStep = usePrevStep();

  const queryClient = useQueryClient();
  const finishSetup = useMutation({
    mutationFn: () => updateSettings({ setup_complete: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      navigate("/", { replace: true });
    },
    onError: (err: any) => {
      addToast({
        variant: "danger",
        content:
          err?.response?.data?.error ||
          err?.message ||
          "Failed to finish setup.",
      });
    },
  });

  return (
    <StepLayout
      icon={
        <div className="w-10 h-10 flex items-center justify-center rounded-vesper-2 bg-vesper-background-success-subtle">
          <Success className="w-7 h-7 text-vesper-icon-success" />
        </div>
      }
      title="You're all set"
      buttons={[
        { children: "Back", onClick: prevStep },
        { children: "Go to TT-Studio", onClick: () => finishSetup.mutate() },
      ]}
    >
      <Typography className="text-vesper-text-secondary">
        Secrets are saved on the server. You can update your Keys and secrets
        anytime in Settings.
      </Typography>
    </StepLayout>
  );
}
