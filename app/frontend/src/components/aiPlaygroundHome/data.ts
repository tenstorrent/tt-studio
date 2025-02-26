// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type { Model, Task } from "./types";

export const models: Model[] = [
  {
    id: "llama",
    title: "Llama 3.1 70b",
    image: "src/assets/llama-image.svg",
    path: "chat",
    filter: "#323968",
    TTDevice: "loudbox",
    poweredByText: "Powered by TT-Loudbox",
  },
  {
    id: "whisper",
    title: "Whisper",
    image: "src/assets/whisper.svg",
    path: "audio",
    filter: "#74C5DF",
    TTDevice: "n150",
    poweredByText: "Powered by Wormhole n150",
  },
  {
    id: "yolov4",
    title: "YOLOV4",
    image: "src/assets/yolo5.svg",
    path: "video",
    filter: "#6FABA0",
    TTDevice: "n150",
    poweredByText: "Powered by Wormhole n150",
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
