// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Logo lookup for marketplace apps.
//
// To add a logo, drop a file into `src/assets/app-logos/` named after the app id
// in shared_config/marketplace_config.py — e.g. `open-webui.svg`, `opencode.svg`.
// Nothing else to wire up: the glob below picks it up at build time, and apps
// without a file fall back to a category icon.
const LOGO_MODULES = import.meta.glob("../assets/app-logos/*.{svg,png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

// Filenames rarely match app ids character-for-character (openwebui vs
// open-webui, anything-llm vs anythingllm), so match on letters and digits only.
const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(LOGO_MODULES).map(([path, url]) => [
    normalize(
      path
        .split("/")
        .pop()!
        .replace(/\.(svg|png|webp)$/, "")
    ),
    url,
  ])
);

export const getAppLogo = (appId: string): string | undefined =>
  LOGOS[normalize(appId)];
