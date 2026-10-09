// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useContext } from "react";
import { OnboardingContext } from "./context";

export function useHfToken() {
  const { hfToken, setHfToken } = useContext(OnboardingContext);
  return [hfToken, setHfToken] as const;
}

export function useCurrentStep() {
  const { step } = useContext(OnboardingContext);
  return step
}

export function useNextStep() {
  const { nextStep } = useContext(OnboardingContext);
  return nextStep
}

export function usePrevStep() {
  const { prevStep } = useContext(OnboardingContext);
  return prevStep
}

export function useNumSteps() {
  const { numSteps } = useContext(OnboardingContext);
  return numSteps
}

export function useSettings() {
  const { settings } = useContext(OnboardingContext);
  return settings
}
