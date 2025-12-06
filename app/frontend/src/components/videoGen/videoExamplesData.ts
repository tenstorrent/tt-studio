// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface VideoExample {
  id: string;
  category: string;
  prompt: string;
  videoPath?: string; // Optional, for future drag-and-drop videos
}

export const videoExamples: VideoExample[] = [
  {
    id: "camera-pulls-back",
    category: "Camera Movement",
    prompt:
      "A soft, round animated character wakes up with a curious expression to find their bed is a giant golden corn kernel. The camera pulls back, revealing that the room is a giant, echoing corn silo where kernels are piled into towering walls.",
    videoPath: "/assets/video-examples/example-1.mp4",
  },
  {
    id: "cinematic-lighting",
    category: "Cinematic Lighting",
    prompt:
      "Sunny lighting, edge lighting, low-contrast, medium close-up shot, left-heavy composition, clean single shot, warm colors, soft lighting, side lighting, day time. A young girl sits in a field of tall grass with two fluffy donkeys standing behind her.",
    videoPath: "/assets/video-examples/example-2.mp4",
  },
  {
    id: "street-dance",
    category: "Motion & Action",
    prompt:
      "A group of diverse, energetic hip-hop dancers performing street dance on a vast stage, illuminated by vibrant neon lights. Dynamic, high-energy, professional dance photography.",
    videoPath: "/assets/video-examples/example-3.mp4",
  },
  {
    id: "3d-cartoon-style",
    category: "Visual Style",
    prompt:
      "3D cartoon style, a surreal dream where everything is made of corn. Main characters ride a corn train through giant corncobs and kernels bathed in warm, golden light.",
    videoPath: "/assets/video-examples/example-4.mp4",
  },
  {
    id: "time-lapse",
    category: "Visual Effects",
    prompt:
      "Time-lapse, dusk, sunset, rim light. An anthropomorphic metal robot walks down a busy city street with glass-walled buildings bathed in sunset afterglow.",
    videoPath: "/assets/video-examples/example-5.mp4",
  },
];
