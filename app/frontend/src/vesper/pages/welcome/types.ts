// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ComponentType, ReactNode } from "react";
import type { ButtonProps } from "@tenstorrent/vesper/button";
import { SettingsResponse } from "@/src/api/settingsApi";

export type StepProps = {
  nextStep(): void;
  prevStep(): void;
};

export type OnboardingStep = {
  component: ComponentType;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  buttons: ButtonProps[];
};

export type OnboardingContextData = {
  hfToken: string
  setHfToken(value: string): void
  step: number
  numSteps: number
  prevStep(): void
  nextStep(): void
  settings: SettingsResponse | undefined
}
