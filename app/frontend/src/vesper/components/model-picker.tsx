// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Link } from "react-router-dom";
import { Select } from "@tenstorrent/vesper/select";
import { Typography } from "@tenstorrent/vesper/typography";
import type { DeployedModelSummary } from "@/src/api/modelsDeployedApis";
import { DEPLOYMENTS_PATH } from "@/src/routes/route-config";

/**
 * Picks which deployed model a demo talks to. When none is ready, explains why
 * and points to the deployments page.
 */
export function ModelPicker({
  label = "Model",
  models,
  isLoading,
  value,
  onChange,
  emptyText,
  disabled,
}: {
  label?: string;
  models: DeployedModelSummary[];
  isLoading: boolean;
  value: string | null;
  onChange(id: string): void;
  /** Shown when no suitable model is deployed, e.g. "No text-to-speech model is ready." */
  emptyText: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-vesper-2">
      <Typography
        as="span"
        variant="label-sm"
        className="text-vesper-text-secondary"
      >
        {label}
      </Typography>
      <Select
        size="lg"
        aria-label={label}
        placeholder={isLoading ? "Loading models…" : "No models ready"}
        disabled={disabled || models.length === 0}
        options={models.map((m) => ({ value: m.id, label: m.modelName }))}
        value={value}
        onValueChange={(id) => id && onChange(id)}
      />
      {!isLoading && models.length === 0 && (
        <Typography
          as="span"
          variant="copy-xs"
          className="text-vesper-text-warning"
        >
          {emptyText}{" "}
          <Link
            to={DEPLOYMENTS_PATH}
            className="underline text-vesper-text-link-default"
          >
            Deploy one
          </Link>
        </Typography>
      )}
    </label>
  );
}
