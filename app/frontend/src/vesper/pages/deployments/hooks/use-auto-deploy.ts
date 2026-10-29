// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { addToast } from "@tenstorrent/vesper/toast";
import { placementFor } from "@/src/utils/deviceFit";
import { parseDeviceIds } from "@/src/utils/p300x2Placement";
import { useChipStatus } from "@/src/vesper/hooks/use-chip-status";
import { useModelCatalog } from "@/src/vesper/hooks/use-model-catalog";
import type { CatalogModel } from "@/src/vesper/types";
import { getErrorMessage } from "@/src/utils/errors";
import { describeDeployError, useDeployModel } from "./use-deploy-model";

/** Resolve a model by exact name, else by a unique partial match, like the CLI does. */
function resolveModel(catalog: CatalogModel[], name: string) {
  const needle = name.toLowerCase();
  const exact = catalog.find((m) => m.name.toLowerCase() === needle);
  if (exact) return { model: exact };
  const loose = catalog.filter((m) => m.name.toLowerCase().includes(needle));
  if (loose.length === 1) return { model: loose[0] };
  if (loose.length > 1) {
    return {
      error: `"${name}" matched several models: ${loose
        .map((m) => m.name)
        .join(", ")}. Re-run with an exact name.`,
    };
  }
  return { error: `Model "${name}" isn't in the catalog.` };
}

/**
 * `python run.py run <model>` opens the app with `?auto-deploy=<model>` (and an
 * optional `&device-id=0,1`). Deploy that model once, then show its progress.
 */
export function useAutoDeploy() {
  const [searchParams, setSearchParams] = useSearchParams();
  const modelName = searchParams.get("auto-deploy");
  const deviceParam = searchParams.get("device-id");
  const catalog = useModelCatalog();
  const { chipStatus, isLoading: chipStatusLoading } = useChipStatus();
  const deploy = useDeployModel();
  const fired = useRef(false);

  useEffect(() => {
    if (!modelName || fired.current) return;
    const clearParams = (next: URLSearchParams) => {
      next.delete("auto-deploy");
      next.delete("device-id");
      return next;
    };

    // without the catalog the model can't be resolved; say so, rather than
    // leave the deploy the CLI asked for silently undone
    if (catalog.isError) {
      fired.current = true;
      addToast({
        variant: "danger",
        content: `Auto-deploy of ${modelName} failed: couldn't load the model catalog (${getErrorMessage(catalog.error)}). Deploy it from the catalog once the backend is reachable.`,
      });
      setSearchParams(clearParams(new URLSearchParams(searchParams)), {
        replace: true,
      });
      return;
    }

    if (!catalog.data || chipStatusLoading) return;
    fired.current = true;

    const toast = addToast({
      variant: "loading",
      content: `Auto-deploying ${modelName} from the CLI…`,
    });

    const { model, error } = resolveModel(catalog.data, modelName);
    if (!model) {
      toast.update({
        variant: "danger",
        content: `Auto-deploy failed: ${error}`,
      });
      setSearchParams(clearParams(new URLSearchParams(searchParams)), {
        replace: true,
      });
      return;
    }

    const pinned = deviceParam ? parseDeviceIds(deviceParam) : [];
    const placement = placementFor(
      model,
      chipStatus?.board_type,
      chipStatus?.total_slots ?? 4
    );
    deploy.mutate(
      {
        modelId: model.id,
        modelName: model.name,
        deviceId:
          pinned.length === 1
            ? pinned[0]
            : pinned.length > 1
              ? pinned.join(",")
              : undefined,
        // the whole-card hint the backend honours only where it matters
        forceFullBoard: pinned.length === 0 && !placement.allowsSingle,
        deviceIds: pinned,
      },
      {
        onSuccess: (result) => {
          toast.update({
            variant: "success",
            content: `Deploying ${model.name}`,
            timeout: 5000,
          });
          const next = clearParams(new URLSearchParams(searchParams));
          next.set("deployment", result.jobId);
          setSearchParams(next, { replace: true });
        },
        onError: (err) => {
          toast.update({
            variant: "danger",
            content: `Auto-deploy failed: ${describeDeployError(err)}`,
          });
          setSearchParams(clearParams(new URLSearchParams(searchParams)), {
            replace: true,
          });
        },
      }
    );
  }, [
    modelName,
    deviceParam,
    catalog.data,
    catalog.isError,
    catalog.error,
    chipStatus,
    chipStatusLoading,
    deploy,
    searchParams,
    setSearchParams,
  ]);
}
