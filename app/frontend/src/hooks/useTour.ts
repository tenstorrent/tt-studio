// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useContext } from "react";
import { TourContext, type TourContextState } from "../contexts/TourContext";

export const useTour = (): TourContextState => {
  const context = useContext(TourContext);

  if (context === undefined) {
    throw new Error("useTour must be used within a TourProvider");
  }

  return context;
};
