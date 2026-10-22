// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useState } from "react";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { AIAgent } from "@tenstorrent/vesper/icons";
import { Skeleton } from "@tenstorrent/vesper/skeleton";
import { Toggle } from "@tenstorrent/vesper/toggle";
import { Typography } from "@tenstorrent/vesper/typography";
import { EmptyPill } from "@/src/vesper/components/empty-pill";
import { ModelLogo } from "@/src/vesper/components/model-logo";
import { useChipStatus } from "@/src/vesper/hooks/use-chip-status";
import { useModelCatalog } from "@/src/vesper/hooks/use-model-catalog";
import type { CatalogModel, DeploymentItem } from "@/src/vesper/types";
import { getModelDescription, getModelTask } from "@/src/vesper/utils/models";
import {
  applyCatalogFilters,
  DEFAULT_FILTERS,
  getCompatibleModels,
  getDeployability,
  type CatalogFilters,
} from "../utils";
import { getVoiceAgentAvailability } from "../solutions";
import { CatalogCard } from "./catalog-card";
import { CatalogFiltersButton } from "./catalog-filters";

export type CatalogTab = "models" | "solutions";

export function Catalog({
  tab,
  loading,
  onTabChange,
  deployments,
  onSelectModel,
  onSelectDeployment,
  onSelectSolution,
}: {
  tab: CatalogTab;
  /**
   * Whether anything the cards depend on is still loading: the catalog, which
   * devices are free, or the deployments. Cards drawn before then would change
   * under the user, e.g. disable once device availability is in.
   */
  loading: boolean;
  onTabChange(tab: CatalogTab): void;
  deployments: DeploymentItem[];
  onSelectModel(model: CatalogModel): void;
  onSelectDeployment(item: DeploymentItem): void;
  onSelectSolution(): void;
}) {
  const catalog = useModelCatalog();
  const { chipStatus } = useChipStatus();
  const [filters, setFilters] = useState<CatalogFilters>(DEFAULT_FILTERS);

  const compatible = useMemo(
    () => getCompatibleModels(catalog.data ?? []),
    [catalog.data]
  );
  const tasks = useMemo(
    () => [...new Set(compatible.map(getModelTask))].sort(),
    [compatible]
  );
  const filtered = useMemo(
    () => applyCatalogFilters(compatible, filters),
    [compatible, filters]
  );

  // a model with a deploy in flight links to its progress instead
  const inFlightByModel = useMemo(() => {
    const map = new Map<string, DeploymentItem>();
    for (const item of deployments) {
      if (
        (item.state === "downloading" || item.state === "deploying") &&
        item.catalogModelId
      ) {
        map.set(item.catalogModelId, item);
      }
    }
    return map;
  }, [deployments]);

  const allDevicesInUse =
    !!chipStatus &&
    chipStatus.slots.length > 0 &&
    chipStatus.slots.every((slot) => slot.status === "occupied");

  const voiceAgent = getVoiceAgentAvailability(catalog.data ?? [], chipStatus);
  const showModels = tab === "models" && !loading;

  return (
    <div className="relative min-h-full flex flex-col gap-vesper-10 p-vesper-10">
      <div className="flex items-center justify-between gap-vesper-4">
        <Toggle
          options={[
            { value: "models", text: "Models" },
            { value: "solutions", text: "Solutions" },
          ]}
          value={tab}
          onValueChange={(value) => onTabChange(value as CatalogTab)}
        />
        {tab === "models" && (
          <CatalogFiltersButton
            filters={filters}
            onChange={setFilters}
            tasks={tasks}
          />
        )}
      </div>

      {tab === "models" && loading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-vesper-6">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} height={138} className="rounded-vesper-2" />
          ))}
        </div>
      )}

      {showModels && catalog.isError && (
        <Admonition variant="danger">
          Couldn't load the model catalog. Check that the backend is running and
          try again.
        </Admonition>
      )}

      {showModels && catalog.isSuccess && filtered.length === 0 && (
        <div className="flex-1 flex items-center justify-center py-vesper-16">
          <EmptyPill>No models match these filters</EmptyPill>
        </div>
      )}

      {showModels && filtered.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-vesper-6">
          {filtered.map((model) => {
            const inFlight = inFlightByModel.get(model.id);
            const deployability = getDeployability(model, chipStatus);
            return (
              <li key={model.id}>
                <CatalogCard
                  task={getModelTask(model)}
                  devices={deployability.devices}
                  icon={
                    <ModelLogo
                      hfModelId={model.hf_model_id}
                      modelName={model.name}
                      className="w-6 h-6"
                    />
                  }
                  name={model.name}
                  description={getModelDescription(model)}
                  status={inFlight ? "Deploying" : undefined}
                  disabled={!inFlight && !deployability.fits}
                  disabledReason={deployability.reason}
                  onSelect={() =>
                    inFlight
                      ? onSelectDeployment(inFlight)
                      : onSelectModel(model)
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      {tab === "solutions" && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-vesper-6">
          <li>
            {loading ? (
              <Skeleton height={138} className="rounded-vesper-2" />
            ) : (
              <CatalogCard
                devices={voiceAgent.devices}
                icon={<AIAgent className="w-6 h-6 text-vesper-icon-primary" />}
                name="Voice Agent"
                description="Deploy the full Voice Agent pipeline in one go: an LLM, Whisper and SpeechT5, each assigned to their own device."
                tags={["Text Generation", "Speech-to-Text", "Text-to-Speech"]}
                disabled={!voiceAgent.available}
                disabledReason={voiceAgent.reason}
                onSelect={onSelectSolution}
              />
            )}
          </li>
        </ul>
      )}

      {!loading && allDevicesInUse && (
        <div className="sticky bottom-vesper-6 mt-auto flex justify-center pointer-events-none">
          <Admonition
            variant="warning"
            subtle
            className="pointer-events-auto shadow-vesper-200"
          >
            All devices currently in use. Clear a device to deploy a new{" "}
            {tab === "models" ? "model" : "solution"}.
          </Admonition>
        </div>
      )}

      {showModels && catalog.isSuccess && compatible.length > 0 && (
        <Typography variant="label-xs" className="text-vesper-text-tertiary">
          Showing {filtered.length} of {compatible.length} models compatible
          with {compatible[0]?.current_board ?? "this board"}.
        </Typography>
      )}
    </div>
  );
}
