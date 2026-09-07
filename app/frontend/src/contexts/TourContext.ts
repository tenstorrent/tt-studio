// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { createContext } from "react";
import type { Step } from "react-joyride";

export interface TourContextState {
  run: boolean;
  stepIndex: number;
  activeTourId: string | null;
  steps: Step[];
  startTour: (tourId?: string, initialStepIndex?: number) => void;
  stopTour: () => void;
  setStepIndex: (index: number) => void;
  isTourCompleted: (tourId?: string) => boolean;
  resetTour: (tourId?: string) => void;
}

export const TourContext = createContext<TourContextState | undefined>(
  undefined
);
