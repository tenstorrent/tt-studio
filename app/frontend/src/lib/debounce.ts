// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export function debounce<F extends (...args: any[]) => void>(
  fn: F,
  waitMs: number
) {
  let timeoutId: number | null = null;
  return (...args: Parameters<F>) => {
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      fn(...args);
    }, waitMs);
  };
}
