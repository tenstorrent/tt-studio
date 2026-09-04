// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Stamp the desktop app version from a release tag.
//
// TT-Studio releases are plain git tags (vX.Y.Z) with no version bumps
// committed to the tree — git is the source of truth for "what build is
// this", the same philosophy as tt_setup/env_config/_version.py for the web
// frontend. The versions checked into tauri.conf.json / Cargo.toml /
// package.json are therefore dev placeholders; release CI runs this script
// to sync all of them (plus Cargo.lock, so locked builds stay consistent)
// to the tag before bundling.
//
// Usage: node scripts/stamp-version.mjs <tag-or-version>   (e.g. v2.10.0)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(dirname(fileURLToPath(import.meta.url)));

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/stamp-version.mjs <tag-or-version>");
  process.exit(1);
}
const version = arg.replace(/^v/, "");
// Tauri and Cargo both require semver (prerelease suffixes like -rc1 are ok).
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`not a semver version: "${arg}"`);
  process.exit(1);
}

function stampJson(relPath) {
  const path = join(desktopDir, relPath);
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.version = version;
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`${relPath}: version = ${version}`);
}

// Replace the version of the tt-studio-desktop package only: in Cargo.toml
// that's the first `version =` in [package]; in Cargo.lock it's the line
// following its `name =` entry (dependencies keep their own versions).
function stampCargo(relPath, pattern) {
  const path = join(desktopDir, relPath);
  const text = readFileSync(path, "utf8");
  const stamped = text.replace(pattern, `$1"${version}"`);
  if (stamped === text) {
    console.error(`${relPath}: found no version to stamp`);
    process.exit(1);
  }
  writeFileSync(path, stamped);
  console.log(`${relPath}: version = ${version}`);
}

stampJson("src-tauri/tauri.conf.json");
stampJson("package.json");
stampCargo("src-tauri/Cargo.toml", /(^version = )"[^"]+"/m);
stampCargo(
  "src-tauri/Cargo.lock",
  /(name = "tt-studio-desktop"\nversion = )"[^"]+"/
);
