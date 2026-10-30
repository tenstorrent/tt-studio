// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useIsResetting } from "@/src/hooks/useIsResetting";
import { useModels } from "@/src/hooks/useModels";

/**
 * Why deploying and stopping models is paused right now, or `null` when it
 * isn't. During a board reset the backend refuses deploys and holds stops
 * until it finishes; while the Docker control service is unreachable neither
 * can run at all (deployed models keep serving).
 */
export function useModelActionsPaused(): string | null {
  const isResetting = useIsResetting();
  const { controlPlaneDegraded } = useModels();
  if (isResetting) {
    return "A board reset is in progress. Deploying and stopping models are paused until it finishes.";
  }
  if (controlPlaneDegraded) {
    return "The Docker control service is unreachable. Deploying and stopping models are paused until it's back; deployed models keep working.";
  }
  return null;
}
