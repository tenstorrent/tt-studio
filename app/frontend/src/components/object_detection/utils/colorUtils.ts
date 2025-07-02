// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export const getConfidenceColorClass = (confidence: number) => {
  if (confidence > 0.7) return "border-green-500";
  if (confidence > 0.5) return "border-yellow-500";
  return "border-red-500";
};

export const getLabelColorClass = (confidence: number) => {
  if (confidence > 0.7) return "bg-green-500";
  if (confidence > 0.5) return "bg-yellow-500";
  return "bg-red-500";
};

export const getConfidenceTextColorClass = (confidence: number) => {
  if (confidence > 0.7) return "text-green-600";
  if (confidence > 0.5) return "text-yellow-600";
  return "text-red-600";
};
