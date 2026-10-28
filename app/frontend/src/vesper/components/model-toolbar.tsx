// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Link } from "react-router-dom";
import { Select } from "@tenstorrent/vesper/select";
import { Typography } from "@tenstorrent/vesper/typography";
import type { DeployedModelSummary } from "@/src/api/modelsDeployedApis";
import { DEPLOYMENTS_PATH } from "@/src/routes/route-config";
import { ModelLogo } from "@/src/vesper/components/model-logo";

/**
 * A bar across the top of a demo page for picking which deployed model it
 * talks to. When none is ready, explains why and points to the deployments
 * page.
 */
export function ModelToolbar({
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
  /** Shown when no suitable model is deployed, e.g. "No image generation model is ready." */
  emptyText: string;
  disabled?: boolean;
}) {
  const selected = models.find((m) => m.id === value);
  return (
    <div className="h-16 shrink-0 flex items-center gap-vesper-4 px-vesper-6 border-b border-vesper-border-tertiary bg-vesper-background-primary text-left">
      <Select
        size="sm"
        className="w-72"
        aria-label={label}
        icon={
          selected && (
            <ModelLogo
              modelName={selected.modelName}
              hfModelId={selected.hfModelId}
              className="w-4 h-4"
            />
          )
        }
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
    </div>
  );
}
