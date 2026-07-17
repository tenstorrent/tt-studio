// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useDeviceState } from "./useDeviceState";

/**
 * True while any board/device reset is in progress, sourced from the global
 * device state. The backend reports `RESETTING` for both single-device resets
 * and the whole-board reset job (including its model-stopping phase), so this
 * one flag locks destructive actions consistently across the whole UI.
 */
export const useIsResetting = (): boolean => {
  const { deviceState } = useDeviceState();
  return deviceState?.state === "RESETTING";
};
