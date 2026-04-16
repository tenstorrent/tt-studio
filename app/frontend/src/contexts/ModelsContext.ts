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
  device_id?: number | null;
}

export interface ModelsContextType {
  models: Model[];
  setModels: React.Dispatch<React.SetStateAction<Model[]>>;
  refreshModels: () => Promise<void>;
  hasDeployedModels: boolean;
  userStoppedModel: boolean;
  setUserStoppedModel: React.Dispatch<React.SetStateAction<boolean>>;
}

export const ModelsContext = createContext<ModelsContextType | undefined>(
  undefined
);
