// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useContext } from "react";
import { FooterVisibilityContext } from "../contexts/FooterVisibilityContext";

export const useFooterVisibility = () => {
  const ctx = useContext(FooterVisibilityContext);
  if (!ctx)
    throw new Error(
      "useFooterVisibility must be used within a FooterVisibilityProvider"
    );
  return ctx;
};
