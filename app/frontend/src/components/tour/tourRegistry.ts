// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Step } from "react-joyride";
import { deployModelSteps } from "./tours/deployModel";
import { onboardingSteps } from "./tours/onboarding";

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
};

export const DEFAULT_TOUR_ID = "onboarding";

export function getTourById(id: string): TourDefinition | undefined {
  return TOUR_REGISTRY[id];
}

export function getAllTours(): TourDefinition[] {
  return Object.values(TOUR_REGISTRY);
}
