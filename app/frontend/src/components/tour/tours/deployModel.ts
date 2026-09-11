// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Step } from "react-joyride";

export const deployModelSteps: Step[] = [
  // Mode selection: Single / Multi Model Deployments
  {
    target: '[data-tour="deploy-mode-single"]',
    title: "Single / Multi Model Deployments",
    content:
      "Deploy individual models one at a time. Supports custom hardware and device configuration for multi-device boards.",
    skipBeacon: true,
    placement: "bottom",
  },
  // Mode selection: Solutions (cross-link to Voice Agent)
  {
    target: '[data-tour="deploy-mode-solutions"]',
    title: "Solutions: Full Pipelines",
    content:
      "Deploy complete multi-model pipelines in one go (such as the Voice Agent with Whisper, LLM, and SpeechT5). Check out the Voice Agent tour to explore this flow!",
    skipBeacon: true,
    placement: "bottom",
  },
  // Model selection: Dropdown
  {
    target: '[data-tour="model-select-dropdown"]',
    title: "Select an AI Model",
    content:
      "Browse available models grouped by type (Chat, Vision, Audio) and readiness status (Complete, Functional, Experimental).",
    skipBeacon: true,
    placement: "bottom",
  },
  // Model selection: Board Info
  {
    target: '[data-tour="board-info-box"]',
    title: "Detected Tenstorrent Hardware",
    content:
      "Shows your detected Tenstorrent accelerator board and current device configuration, ensuring the chosen model fits your hardware.",
    skipBeacon: true,
    placement: "top",
  },
  // Hardware config: Advanced toggle (P300x2 / multi-chip simplified path)
  {
    target: '[data-tour="hardware-config-toggle"]',
    title: "Advanced Device Configuration",
    content:
      "For multi-device systems, open advanced configuration to customize which physical device slots your model runs on.",
    skipBeacon: true,
    placement: "bottom-end",
  },
  // Hardware config: 1 Device card
  {
    target: '[data-tour="hardware-mode-single"]',
    title: "1 Device Configuration",
    content:
      "Deploy on a single device or card. Best for lightweight to medium models (such as 8B–13B parameters).",
    skipBeacon: true,
    placement: "bottom-start",
  },
  // Hardware config: All Devices card
  {
    target: '[data-tour="hardware-mode-multi"]',
    title: "All Devices Configuration",
    content:
      "Deploy across all available devices simultaneously. Required for large 70B+ models.",
    skipBeacon: true,
    placement: "bottom-end",
  },
  // Hardware config: Slot picker
  {
    target: '[data-tour="chip-slot-picker"]',
    title: "Device Slot Picker",
    content:
      "Inspect real-time slot availability (/dev/tenstorrent/N) and select free IDLE slots for deployment.",
    skipBeacon: true,
    placement: "top",
  },
  // Hardware config: Continue / Next
  {
    target: '[data-tour="hardware-config-continue"]',
    title: "Continue to Deployment",
    content:
      "Proceed to the final deployment step once your model and device choices are confirmed.",
    skipBeacon: true,
    placement: "top-end",
  },
  // Deploy: Summary info
  {
    target: '[data-tour="deploy-summary-info"]',
    title: "Deployment Summary",
    content:
      "Review your selected model, allocated devices, and runtime settings before launching the container.",
    skipBeacon: true,
    placement: "top",
  },
  // Deploy: Deploy button
  {
    target: '[data-tour="deploy-button"]',
    title: "Deploy Model",
    content:
      "Click Deploy Model to launch the model container. On success, you will be redirected to /models-deployed to monitor and interact with your running model!",
    skipBeacon: true,
    placement: "top",
  },
];
