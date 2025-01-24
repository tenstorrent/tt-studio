// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
export function parseLogFileName() {
  const LogFileName = (name: string) => {
    const parts = name.split("_");
    if (parts.length > 2) {
      const date = parts[0];
      const time = parts[1].replace(/-/g, ":");
      const rest = parts.slice(2).join("_");
      return (
        <div className="flex flex-col">
          <span className="font-medium">{rest}</span>
          <span className="text-xs text-muted-foreground">{`${date} ${time}`}</span>
        </div>
      );
    }
    return name;
  };

  LogFileName.displayName = "LogFileName";
  return LogFileName;
}
