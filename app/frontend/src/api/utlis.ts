// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect } from "react";

export function useSetTitle() {
  useEffect(() => {
    // const isLocalhost = window.location.hostname === "localhost";
    const defaultTitle = import.meta.env.VITE_APP_TITLE || "TT-Studio";
    // console.log("defaultTitle", defaultTitle);

    document.title = defaultTitle;
  }, []);
}
