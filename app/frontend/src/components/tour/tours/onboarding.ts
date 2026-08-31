// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Step } from "react-joyride";

export const onboardingSteps: Step[] = [
  {
    target: '[data-tour="nav-home"]',
    title: "Welcome to TT-Studio",
    content:
      "TT-Studio lets you deploy, run, and interact with AI models optimized for Tenstorrent hardware.",
    skipBeacon: true,
    placement: "bottom",
  },
  {
    target: '[data-tour="deploy-mode-single"]',
    title: "Deploy Individual Models",
    content:
      "Choose Single / Multi Model Deployments to configure hardware slots, pick models from our catalog, and launch inference servers.",
    skipBeacon: true,
    placement: "right",
  },
  {
    target: '[data-tour="deploy-mode-solutions"]',
    title: "End-to-End Solutions",
    content:
      "Deploy multi-model solutions like the Voice Agent (Whisper + LLM + SpeechT5) configured across multiple chips with one click.",
    skipBeacon: true,
    placement: "right",
  },
  {
    target: '[data-tour="nav-models"]',
    title: "Manage Deployed Models",
    content:
      "Navigate here to view running models, device allocations, real-time container logs, and deployment history.",
    skipBeacon: true,
    placement: "bottom",
  },
  {
    target: '[data-tour="tour-help"]',
    title: "Replay Tours Anytime",
    content:
      "Need a refresher? Click the Help button anytime to restart this tour or choose another guided walkthrough from the menu.",
    skipBeacon: true,
    placement: "bottom-end",
  },
];
