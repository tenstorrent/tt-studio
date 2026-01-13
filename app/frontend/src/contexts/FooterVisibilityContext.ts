// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { createContext } from "react";

export type FooterVisibilityContextType = {
  showFooter: boolean;
  setShowFooter: (val: boolean) => void;
};

export const FooterVisibilityContext = createContext<
  FooterVisibilityContextType | undefined
>(undefined);
