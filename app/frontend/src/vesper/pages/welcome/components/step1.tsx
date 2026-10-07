// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Typography } from "@tenstorrent/vesper/typography";
import { StepLayout } from "./step-layout";
import { Tenstorrent } from "@tenstorrent/vesper/icons";
import { useNextStep } from "../utils";

export function Step1() {
  const nextStep = useNextStep()

  return (
    <StepLayout
      icon={
        <div className="w-10 h-10 flex items-center justify-center rounded-vesper-2 bg-vesper-background-accent-subtle">
          <Tenstorrent className="w-7 h-7 text-vesper-icon-accent" />
        </div>
      }
      title="Welcome to TT-Studio"
      buttons={[{ children: "Get started", onClick: nextStep }]}
    >
      <Typography className="text-vesper-text-secondary text-center">
        A quick setup to get your AI models running on Tenstorrent hardware. You
        can paste your API Keys now or configure them later in Settings.
      </Typography>
    </StepLayout>
  );
}
