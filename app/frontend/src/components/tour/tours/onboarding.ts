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
    disableBeacon: true,
    placement: "bottom-start",
  },
  {
    target: '[data-tour="nav-models"]',
    title: "Manage Deployed Models",
    content:
      "Monitor active containers, inspect streaming logs, check device health, and review deployment history.",
    skipBeacon: true,
    disableBeacon: true,
    placement: "bottom",
  },
  {
    target: '[data-tour="nav-tools"]',
    title: "AI Tools & Workflows",
    content:
      "Access advanced utilities including RAG knowledge bases, visual workflows, interactive canvas, and agent integrations.",
    skipBeacon: true,
    disableBeacon: true,
    placement: "bottom",
  },
  {
    target: '[data-tour="nav-interactions"]',
    title: "Model Interaction",
    content:
      "Directly test and interact with your deployed models across Chat, Computer Vision, Speech-to-Text, and Media Generation.",
    skipBeacon: true,
    disableBeacon: true,
    placement: "bottom",
  },
  {
    target: '[data-tour="nav-actions"]',
    title: "System Controls",
    content:
      "Quickly reset board state, adjust application settings, or report issues directly from the navbar.",
    skipBeacon: true,
    disableBeacon: true,
    placement: "bottom-end",
  },
  {
    target: '[data-tour="tour-help"]',
    title: "Replay Tours Anytime",
    content:
      "Need a refresher? Click the Help button anytime to restart this tour or choose another guided walkthrough from the menu.",
    skipBeacon: true,
    disableBeacon: true,
    placement: "bottom-end",
  },
];
