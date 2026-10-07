// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useQuery } from "@tanstack/react-query";
import { getSettings, SettingsResponse } from "@/src/api/settingsApi";
import { Typography } from "@tenstorrent/vesper/typography";
import { Snippet } from "@tenstorrent/vesper/snippet";
import { TextInput } from "@tenstorrent/vesper/text-input";
import { Lock } from "@tenstorrent/vesper/icons";

export function ServingBackend() {
  const settings = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const artifact = settings.data?.artifact;
  const loading = !artifact;

  const artifactText = loading
    ? "Loading..."
    : artifact.branch || artifact.version || "Unset";

  return (
    <div className="mt-vesper-8 flex flex-col gap-vesper-4">
      <div className="flex flex-col gap-vesper-1">
        <Typography
          as="h3"
          variant="copy-sm-bold"
          className="text-vesper-text-primary"
        >
          tt-inference artifact
        </Typography>
        <Typography variant="copy-xs" className="text-vesper-text-secondary">
          Pins which tt-inference server release TT-Studio is built against.
        </Typography>
      </div>
      <Typography
        as="div"
        variant="label-sm"
        className="text-vesper-text-secondary flex gap-vesper-2 items-center h-10 pl-vesper-3 pr-vesper-4 bg-vesper-tint-neutral-200 rounded-vesper-1 w-fit"
      >
        <Lock width={16} />
        <span>{artifactText}</span>
      </Typography>
      <div className="flex flex-col gap-vesper-1">
        <Typography variant="copy-xs" className="text-vesper-text-secondary">
          To change it, run this code and deploy:
        </Typography>
        <Snippet>{"python run.py --reconfigure-inference-server"}</Snippet>
      </div>
    </div>
  );
}
