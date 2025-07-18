// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
/// <reference types="vite/client" />

// SVG module declarations
declare module "*.svg" {
  const content: string;
  export default content;
}
