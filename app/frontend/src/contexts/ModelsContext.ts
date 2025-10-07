// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from "react";
import { createContext } from "react";

export interface Model {
  id: string;
  name: string;
  image: string;
  status: string;
  health: string;
  ports: string;
}

export interface ModelsContextType {
  models: Model[];
  setModels: React.Dispatch<React.SetStateAction<Model[]>>;
  refreshModels: () => Promise<void>;
  hasDeployedModels: boolean;
}

export const ModelsContext = createContext<ModelsContextType | undefined>(
  undefined
);
