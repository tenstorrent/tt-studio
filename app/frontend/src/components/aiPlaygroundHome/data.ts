// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

/**
 * AI Playground Home - Model Configuration
 * --------------------------------------
 * Configuration for AI models displayed in the Playground home page grid.
 * Each entry renders as an interactive ModelCard with hover effects and navigation.
 *
 * Display Context:
 * - Rendered in a responsive grid on the AI Playground homepage
 * - Cards maintain consistent sizing and spacing
 * - Hover effects reveal additional model information
 * - Clicking navigates to the model's specific playground interface
 *
 * Model Entry Structure:
 * {
 *   id: string           - Unique identifier (e.g., "llama", "stable-diffusion")
 *   title: string        - Model name displayed on card (e.g., "Llama 3.1 70b")
 *   image: string        - Model preview image path
 *   path: string         - Route to model's playground (e.g., "/chat")
 *   filter: string       - Brand color overlay for visual consistency
 *   TTDevice: string     - Tenstorrent hardware badge (e.g., "loudbox")
 *   poweredByText: string - Hardware info shown on hover
 * }
 *
 * Visual Guidelines:
 * - Images: Use 16:10 or 4:3 aspect ratio for grid consistency
 * - Colors: Filter colors should align with AI Playground theme
 * - Typography: Title appears in bottom left with device badge in bottom right
 * - Hover: Cards scale slightly and show poweredByText overlay
 *
 * Navigation:
 * - Each card links to its corresponding playground interface
 * - Use absolute paths starting with '/' for routing
 * - Paths should match your playground route configuration
 *
 * Example Card Interaction:
 * 1. User sees grid of model cards on homepage
 * 2. Hovering reveals "Powered by TT-Device" message
 * 3. Clicking navigates to model-specific interface
 *
 * @see ModelCard.tsx component for card implementation
 * @see DeployedHome.tsx Playground home page for grid layout
 */

// No static imports for model logos to avoid build errors if files missing

import type { Model, Task } from "./types";

export const models: Model[] = [
  {
    id: "llama",
    title: "Llama 3.3 70B",
    image: "/src/assets/aiPlayground/model-logo/llama.svg",
    path: "/chat",
    filter: "#323968",
    TTDevice: "LoudBox",
    poweredByText: "Powered by TT-LoudBox",
    modelType: "LLM",
    tpBadge: { customText: "TP=8, Batch=32" },
  },

  {
    id: "whisper",
    title: "Whisper",
    image: "/src/assets/aiPlayground/model-logo/whisper.svg",
    path: "/speech-to-text",
    filter: "#74C5DF",
    TTDevice: "n150",
    poweredByText: "Powered by Wormhole n150",
    modelType: "Audio",
    tpBadge: { customText: "Batch=1" },
  },
  {
    id: "yolov4",
    title: "YOLOv4",
    image: "/src/assets/aiPlayground/model-logo/yolo.svg",
    path: "/object-detection",
    filter: "#6FABA0",
    TTDevice: "n150",
    poweredByText: "Powered by Wormhole n150",
    modelType: "CNN",
    tpBadge: { customText: "Batch=1" },
  },
  {
    id: "stable-diffusion",
    title: "Stable Diffusion",
    image: "/src/assets/aiPlayground/model-logo/stable_diffusion.svg",
    path: "/image-generation",
    filter: "#4A5568",
    TTDevice: "n300",
    poweredByText: "Powered by Wormhole n300",
    modelType: "ImageGen",
    tpBadge: { customText: "Batch=1" },
  },
  {
    id: "video-generation",
    title: "Video Generation",
    image: "/src/assets/aiPlayground/model-logo/stable_diffusion.svg",
    path: "/video-generation",
    filter: "#5A4A78",
    TTDevice: "n300",
    poweredByText: "Powered by Wormhole n300",
    modelType: "VideoGen",
    tpBadge: { customText: "Batch=1" },
  },
];

export const tasks: Task[] = [
  {
    id: "sentiment-analysis-1",
    title: "Sentiment Analysis",
    path: "/tasks/sentiment",
    className: "bg-[#0D4D62]",
  },
  {
    id: "question-answering",
    title: "Question Answering",
    path: "/tasks/qa",
    className: "bg-[#103525]",
  },
  {
    id: "topic-extraction",
    title: "Topic Extraction",
    path: "/tasks/topic",
    className: "bg-[#101636]",
  },
  {
    id: "keyword-extraction",
    title: "Keyword Extraction",
    path: "/tasks/keyword",
    className: "bg-[#252C5B]",
  },
  {
    id: "named-entity-recognition",
    title: "Named Entity Recognition",
    path: "/tasks/ner",
    className: "bg-[#8D2914]",
  },
  {
    id: "sentiment-analysis-2",
    title: "Sentiment Analysis 2.0",
    path: "/tasks/sentiment-alt",
    className: "bg-[#4B456E]",
  },
];
