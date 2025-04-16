// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface TPBadgeConfig {
  value?: number; // If not provided, will be determined by TTDevice
  stripeColor?: string; // Color of the decorative stripes, defaults to #ff6b6b
  showStripes?: boolean; // Whether to show the stripes, defaults to true
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right"; // Position of the badge
}

export interface StatusIndicatorConfig {
  show?: boolean; // Whether to show the status indicator
  color?: string; // Color of the status indicator, defaults to green-500
  animate?: boolean; // Whether to show the ping animation
}

export interface ParticleEffectConfig {
  enabled?: boolean; // Whether to show particle effects on hover
  count?: number; // Number of particles, defaults to 10
  color?: string; // Color of particles, defaults to TT-purple-accent1
  speed?: number; // Base speed of particles, defaults to 0.5
}

export interface HoverEffectConfig {
  rotate?: boolean; // Whether to enable 3D rotation on hover
  scale?: number; // Scale factor on hover, defaults to 1.03
  glow?: boolean; // Whether to show the purple glow effect on hover
  particleEffect?: ParticleEffectConfig;
}

export interface ModelTypeIconConfig {
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  showBackground?: boolean; // Whether to show the dark background
  rotate?: boolean; // Whether to rotate on hover
  size?: "small" | "medium" | "large"; // Icon size, affects both icon and container
}

export interface Model {
  id: string;
  title: string;
  image: string;
  path: string;
  filter: string;
  filterSvg?: string;
  TTDevice?: string;
  poweredByText: string;
  modelType?: "LLM" | "CNN" | "Audio" | "NLP";
  tpBadge?: TPBadgeConfig; // Optional TP badge configuration
  statusIndicator?: StatusIndicatorConfig;
  hoverEffects?: HoverEffectConfig;
  modelTypeIcon?: ModelTypeIconConfig;
}

export interface Task {
  id: string;
  title: string;
  path: string;
  className: string;
}
