// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { Step } from "react-joyride";

export const FINE_TUNE_TOUR_ID = "fine-tune-model";

/**
 * Marker shared by every step that lives inside the "New Training Job" dialog.
 * TrainingPage opens the dialog while the active step targets one of these.
 */
export const TRAINING_DIALOG_TOUR_PREFIX = '[data-tour="training-dialog-';

// Page-level steps set skipScroll: react-joyride 3.2 stalls when a later step
// needs the document scrolled, so TrainingPage scrolls each target into view.
export const fineTuneModelSteps: Step[] = [
  {
    target: '[data-tour="training-page-header"]',
    skipScroll: true,
    title: "Fine-Tune on Tenstorrent Hardware",
    content:
      "This page runs LoRA fine-tuning jobs against a deployed training container. If none is running yet, deploy a Training model from the Home page first — it then shows up under Models Deployed as Training (Beta).",
    skipBeacon: true,
    placement: "bottom-start",
  },
  {
    target: '[data-tour="training-new-job-button"]',
    skipScroll: true,
    title: "Start a New Training Job",
    content:
      "Click New Training Job to configure a fine-tuning run. The next steps walk through the dialog that opens.",
    skipBeacon: true,
    placement: "bottom-end",
  },
  {
    target: '[data-tour="training-dialog-model"]',
    title: "Choose a Base Model",
    content:
      "Select the model to fine-tune. Only models supported by the running training container and your detected hardware are listed.",
    skipBeacon: true,
    placement: "bottom-start",
  },
  {
    target: '[data-tour="training-dialog-dataset"]',
    title: "Pick a Dataset",
    content:
      "Choose a built-in dataset, or one of your own uploads under Custom Datasets (uploading is covered a few steps ahead). A custom dataset unlocks a prompt template, column mapping, and an optional evaluation split.",
    skipBeacon: true,
    placement: "bottom-end",
  },
  {
    target: '[data-tour="training-dialog-hyperparameters"]',
    title: "Tune Hyperparameters",
    content:
      "Set the learning rate, batch size, epochs, and maximum sequence length. The defaults are a sensible starting point for most datasets.",
    skipBeacon: true,
    placement: "top",
  },
  {
    target: '[data-tour="training-dialog-lora"]',
    title: "LoRA Configuration",
    content:
      "Control the adapter rank, alpha, and target modules. Lower ranks train faster and produce smaller adapters; higher ranks capture more from your data.",
    skipBeacon: true,
    placement: "top",
  },
  {
    target: '[data-tour="training-dialog-submit"]',
    title: "Launch Training",
    content:
      "Click Start Training to queue the job. It appears in the Jobs table immediately and moves to Running once compilation finishes.",
    skipBeacon: true,
    placement: "top-end",
  },
  {
    target: '[data-tour="training-jobs-table"]',
    skipScroll: true,
    title: "Monitor Your Jobs",
    content:
      "Track status and step progress here. Click any job to open its detail page with live loss curves, logs, and saved checkpoints — or cancel a job that is still queued or running.",
    skipBeacon: true,
    placement: "top",
  },
  {
    target: '[data-tour="dataset-upload-panel"]',
    skipScroll: true,
    title: "Bring Your Own Dataset",
    content:
      "To fine-tune on your own data, upload it here as a JSON or JSONL file. Drag a file into the drop zone (or browse for one) to preview its rows and columns before uploading it to the training container.",
    skipBeacon: true,
    placement: "top",
  },
  {
    target: '[data-tour="dataset-uploaded-list"]',
    skipScroll: true,
    title: "Reuse Uploaded Datasets",
    content:
      "Everything you have uploaded is listed here. Select one to preview it again; each upload is offered under Custom Datasets in the New Training Job dialog.",
    skipBeacon: true,
    placement: "bottom",
  },
  {
    target: "body",
    title: "Promote for Inference",
    content:
      "When a job completes, open it and switch to the Checkpoints tab. Click Promote for inference on a checkpoint to merge the LoRA adapter into a full set of base-model weights ready for serving.",
    skipBeacon: true,
    placement: "center",
  },
  {
    target: "body",
    title: "Deploy Your Fine-Tuned Model",
    content:
      "Head back to the Home page and deploy the same base model. Promoted checkpoints appear in the Fine-tuned weights picker on the deploy step, so your model serves with your custom weights.",
    skipBeacon: true,
    placement: "center",
  },
];
