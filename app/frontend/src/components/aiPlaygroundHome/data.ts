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
 * id: string - Unique identifier (e.g., "llama", "stable-diffusion")
 * title: string - Model name displayed on card (e.g., "Llama 3.1 70b")
 * image: string - Model preview image path
 * path: string - Route to model's playground (e.g., "/chat-ui")
 * filter: string - Brand color overlay for visual consistency
 * TTDevice: string - Tenstorrent hardware badge (e.g., "loudbox")
 * poweredByText: string - Hardware info shown on hover
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
import type { Model, Task } from "./types";
export const models: Model[] = [
 {
id: "llama",
title: "Llama 3.3 70B",
image: "src/assets/llama-image.svg",
path: "/chat",
filter: "#323968",
TTDevice: "LoudBox",
poweredByText: "Powered by TT-LoudBox",
modelType: "LLM",
 },
 {
id: "whisper",
title: "Whisper",
image: "src/assets/whisper.svg",
path: "/speech-to-text",
filter: "#74C5DF",
TTDevice: "n150",
poweredByText: "Powered by Wormhole n150",
modelType: "Audio",
 },
 {
id: "yolov4",
title: "YOLOv4",
image: "src/assets/yolo5.svg",
path: "/object-detection",
filter: "#6FABA0",
TTDevice: "n150",
poweredByText: "Powered by Wormhole n150",
modelType: "CNN",
 },
 {
id: "stable-diffusion",
title: "Stable Diffusion",
image: "/src/assets/SD1.4/generated-image-1738773382747.jpg",
path: "/image-generation",
filter: "#B85CDA",
TTDevice: "n150",
poweredByText: "Powered by Wormhole n150",
modelType: "CNN",
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