// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Step } from "react-joyride";

// Mode selection: Single / Multi Model Deployments
export const MODE_SINGLE_STEP: Step = {
  target: '[data-tour="deploy-mode-single"]',
  title: "Single / Multi Model Deployments",
  content:
    "Deploy individual models one at a time. Supports custom hardware and device configuration for multi-device boards.",
  skipBeacon: true,
  placement: "bottom",
};

// Mode selection: Solutions (cross-link to Voice Agent)
export const MODE_SOLUTIONS_STEP: Step = {
  target: '[data-tour="deploy-mode-solutions"]',
  title: "Solutions: Full Pipelines",
  content:
    "Deploy complete multi-model pipelines in one go (such as the Voice Agent with Whisper, LLM, and SpeechT5). Check out the Voice Agent tour to explore this flow!",
  skipBeacon: true,
  placement: "bottom",
};

// Model selection: Dropdown
export const MODEL_SELECT_STEP: Step = {
  target: '[data-tour="model-select-dropdown"]',
  title: "Select an AI Model",
  content:
    "Browse available models grouped by type (Chat, Vision, Audio) and readiness status (Complete, Functional, Experimental).",
  skipBeacon: true,
  placement: "bottom",
};

// Model selection: Board Info
export const BOARD_INFO_STEP: Step = {
  target: '[data-tour="board-info-box"]',
  title: "Detected Tenstorrent Hardware",
  content:
    "Shows your detected Tenstorrent accelerator board and current device configuration, ensuring the chosen model fits your hardware.",
  skipBeacon: true,
  placement: "top",
};

// Hardware config: Advanced toggle (P300x2 simplified path)
export const HARDWARE_CONFIG_TOGGLE_STEP: Step = {
  target: '[data-tour="hardware-config-toggle"]',
  title: "Advanced Device Configuration",
  content:
    "For multi-device systems, you can click this toggle to open advanced configuration and choose specific device slots, or click Next to proceed with automatic device placement.",
  skipBeacon: true,
  placement: "bottom-end",
};

// Hardware config: 1 Device card
export const HARDWARE_MODE_SINGLE_STEP: Step = {
  target: '[data-tour="hardware-mode-single"]',
  title: "1 Device Configuration",
  content:
    "Deploy on a single device or card. Best for lightweight to medium models (such as 8B–13B parameters).",
  skipBeacon: true,
  placement: "bottom-start",
};

// Hardware config: All Devices card
export const HARDWARE_MODE_MULTI_STEP: Step = {
  target: '[data-tour="hardware-mode-multi"]',
  title: "All Devices Configuration",
  content:
    "Deploy across all available devices simultaneously. Required for large 70B+ models.",
  skipBeacon: true,
  placement: "bottom-end",
};

// Hardware config: Slot picker
export const CHIP_SLOT_PICKER_STEP: Step = {
  target: '[data-tour="chip-slot-picker"]',
  title: "Device Slot Picker",
  content:
    "Inspect real-time slot availability (/dev/tenstorrent/N) and select free IDLE slots for deployment.",
  skipBeacon: true,
  placement: "top",
};

// Hardware config: Continue / Next
export const HARDWARE_CONFIG_CONTINUE_STEP: Step = {
  target: '[data-tour="hardware-config-continue"]',
  title: "Continue to Deployment",
  content:
    "Proceed to the final deployment step once your model and device choices are confirmed.",
  skipBeacon: true,
  placement: "top-end",
};

// Deploy: Summary info
export const DEPLOY_SUMMARY_STEP: Step = {
  target: '[data-tour="deploy-summary-info"]',
  title: "Deployment Summary",
  content:
    "Review your selected model, allocated devices, and runtime settings before launching the container.",
  skipBeacon: true,
  placement: "top",
};

// Deploy: Deploy button
export const DEPLOY_BUTTON_STEP: Step = {
  target: '[data-tour="deploy-button"]',
  title: "Deploy Model",
  content:
    "Click Deploy Model to launch the model container. On success, you will be redirected to /models-deployed to monitor and interact with your running model!",
  skipBeacon: true,
  placement: "top",
};

export interface DeployTourOptions {
  isMultiChip?: boolean;
  isConfigExpanded?: boolean;
  hasModeSelection?: boolean;
}

/**
 * Dynamically generates tour steps tailored to the user's detected hardware and view state.
 * - Single-chip boards (N150): 6 steps (no hardware config steps)
 * - P300x2 simplified flow (collapsed config): 7 steps (points to the Advanced toggle)
 * - Multi-chip full flow (expanded config): 10 steps (all device cards + slot picker)
 * - Skips mode selection steps if hasModeSelection is false
 */
export function getDeployModelSteps(options?: DeployTourOptions): Step[] {
  const isMultiChip = options?.isMultiChip ?? true;
  const isConfigExpanded = options?.isConfigExpanded ?? false;
  const hasModeSelection = options?.hasModeSelection ?? true;

  const steps: Step[] = [];

  if (hasModeSelection) {
    steps.push(MODE_SINGLE_STEP, MODE_SOLUTIONS_STEP);
  }

  steps.push(MODEL_SELECT_STEP, BOARD_INFO_STEP);

  if (isMultiChip) {
    if (!isConfigExpanded) {
      // Simplified 2-step path on multi-device systems (e.g. P300x2 default)
      steps.push(HARDWARE_CONFIG_TOGGLE_STEP);
    } else {
      // Full multi-chip configuration path
      steps.push(
        HARDWARE_MODE_SINGLE_STEP,
        HARDWARE_MODE_MULTI_STEP,
        CHIP_SLOT_PICKER_STEP,
        HARDWARE_CONFIG_CONTINUE_STEP
      );
    }
  }

  steps.push(DEPLOY_SUMMARY_STEP, DEPLOY_BUTTON_STEP);
  return steps;
}

/**
 * Base 10-step definition for tour registry and static references.
 */
export const deployModelSteps: Step[] = getDeployModelSteps({
  isMultiChip: true,
  isConfigExpanded: true,
});
