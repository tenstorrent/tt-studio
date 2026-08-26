// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect } from "react";
import { useActiveDeploymentsContext } from "../providers/ActiveDeploymentsContext";

/**
 * Hide the floating deployment tray while the calling component is mounted.
 *
 * The Voice Agent page renders a progress card per model. The tray would show the
 * same deploys a second time, derived from its own independent poller and its own
 * hadImagePull tracking — so the two disagree on the percentage for the same moment.
 * One surface owns the display there; the tray still covers every other page, where
 * it is the only indicator.
 */
export function useHideDeploymentTray(): void {
  const { setTrayHidden } = useActiveDeploymentsContext();
  useEffect(() => {
    setTrayHidden(true);
    return () => setTrayHidden(false);
  }, [setTrayHidden]);
}
