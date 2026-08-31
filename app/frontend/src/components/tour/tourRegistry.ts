// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Step } from "react-joyride";
import { onboardingSteps } from "./tours/onboarding";

export interface TourDefinition {
  id: string;
  title: string;
  description: string;
  steps: Step[];
}

export const TOUR_REGISTRY: Record<string, TourDefinition> = {
  onboarding: {
    id: "onboarding",
    title: "Welcome & Overview",
    description: "Learn how to navigate TT-Studio and deploy AI models.",
    steps: onboardingSteps,
  },
};

export const DEFAULT_TOUR_ID = "onboarding";

export function getTourById(id: string): TourDefinition | undefined {
  return TOUR_REGISTRY[id];
}

export function getAllTours(): TourDefinition[] {
  return Object.values(TOUR_REGISTRY);
}
