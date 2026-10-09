// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
//
import { createContext } from "react";
import { type OnboardingContextData } from "./types";

export const OnboardingContext = createContext<OnboardingContextData>({
  hfToken: "",
  setHfToken() {},
  step: 0,
  numSteps: 1,
  nextStep() {},
  prevStep() {},
  settings: undefined,
});
