// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React from "react";
import { createContext } from "react";

export interface Model {
  id: string;
  name: string;
  image: string;
  status: string;
  health: string;
  ports: string;
  model_type?: string;
  coding_agent_eligible?: boolean;
  device_id?: number | null;
  device_ids?: number[];
  /** Managed deployment no longer attached to tt_studio_network (a stray). */
  disconnected?: boolean;
}

export interface ModelsContextType {
  models: Model[];
  setModels: React.Dispatch<React.SetStateAction<Model[]>>;
  refreshModels: () => Promise<void>;
  hasDeployedModels: boolean;
  userStoppedModel: boolean;
  setUserStoppedModel: React.Dispatch<React.SetStateAction<boolean>>;
  isDeleteInFlight: boolean;
  setIsDeleteInFlight: React.Dispatch<React.SetStateAction<boolean>>;
  /**
   * docker-control-service is unreachable, so container management is paused.
   * Deployed models keep serving; this only gates deploy/stop and tells the UI
   * to explain why. Clears on its own once the service answers again.
   */
  controlPlaneDegraded: boolean;
}

export const ModelsContext = createContext<ModelsContextType | undefined>(
  undefined
);
