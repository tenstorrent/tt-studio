// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Step } from "react-joyride";
import { deployModelSteps } from "./tours/deployModel";
import { onboardingSteps } from "./tours/onboarding";
import {
  FINE_TUNE_TOUR_ID,
  fineTuneModelSteps,
} from "./tours/fineTuneModel";

export interface TourDefinition {
  id: string;
  title: string;
  description: string;
  steps: Step[];
  route?: string;
}

export const TOUR_REGISTRY: Record<string, TourDefinition> = {
  onboarding: {
    id: "onboarding",
    title: "Welcome & Navigation",
    description: "Overview of key TT-Studio surfaces and navigation controls.",
    steps: onboardingSteps,
  },
  "deploy-model": {
    id: "deploy-model",
    title: "Deploy Your First Model",
    description:
      "Walk through selecting a deployment mode, configuring hardware, and launching a model.",
    steps: deployModelSteps,
    route: "/",
  },
  [FINE_TUNE_TOUR_ID]: {
    id: FINE_TUNE_TOUR_ID,
    title: "Fine-Tune & Promote a Model",
    description:
      "Upload a custom dataset, configure and launch a LoRA training job, then promote a checkpoint for inference.",
    steps: fineTuneModelSteps,
    route: "/training",
  },
};

export const DEFAULT_TOUR_ID = "onboarding";

export function getTourById(id: string): TourDefinition | undefined {
  return TOUR_REGISTRY[id];
}

export function getAllTours(): TourDefinition[] {
  return Object.values(TOUR_REGISTRY);
}
