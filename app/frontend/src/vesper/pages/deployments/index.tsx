// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { MenuItemProps } from "@tenstorrent/vesper/menu";
import { addToast } from "@tenstorrent/vesper/toast";
import { Typography } from "@tenstorrent/vesper/typography";
import { cancelDeployment, deleteModel } from "@/src/api/modelsDeployedApis";
import { useModels } from "@/src/hooks/useModels";
import { useActiveDeploymentsContext } from "@/src/providers/ActiveDeploymentsContext";
import { getErrorMessage } from "@/src/utils/errors";
import { BackButton } from "@/src/vesper/components/back-button";
import { ContainerLogsModal } from "@/src/vesper/components/container-logs-modal";
import { EmptyPill } from "@/src/vesper/components/empty-pill";
import { ResetHardwareModal } from "@/src/vesper/components/reset-hardware-modal";
import {
  WorkflowLogsModal,
  type WorkflowLogsTarget,
} from "@/src/vesper/components/workflow-logs-modal";
import { useChipStatus } from "@/src/vesper/hooks/use-chip-status";
import { useDeployments } from "@/src/vesper/hooks/use-deployments";
import { useModelCatalog } from "@/src/vesper/hooks/use-model-catalog";
import type { CatalogModel, DeploymentItem } from "@/src/vesper/types";
import { getDemosForModelType } from "@/src/vesper/utils/models";
import { Catalog, type CatalogTab } from "./components/catalog";
import { DeployModel } from "./components/deploy-model";
import { DeploySolution } from "./components/deploy-solution";
import { DeploymentDetail } from "./components/deployment-detail";
import { DeploymentsPanel } from "./components/deployments-panel";
import { SolutionDetail } from "./components/solution-detail";
import { StopDeploymentModal } from "./components/stop-deployment-modal";
import { useAutoDeploy } from "./hooks/use-auto-deploy";
import { describeDeployError, useDeployModel } from "./hooks/use-deploy-model";
import { SOLUTION_KEY_PREFIX, useSolutionGroups } from "./solution-groups";
import { buildAutoDeployRequest } from "./utils";

export default function DeploymentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { items, isLoading, dismiss } = useDeployments();
  const { groupedItems, addGroup, removeGroup } = useSolutionGroups(
    items,
    isLoading
  );
  const { chipStatus } = useChipStatus();
  const catalog = useModelCatalog();
  const { removeDeployment } = useActiveDeploymentsContext();
  const { refreshModels } = useModels();
  const deploy = useDeployModel();

  useAutoDeploy();

  const [stopping, setStopping] = useState<{
    item: DeploymentItem;
    redeploy: boolean;
  } | null>(null);
  const [logsFor, setLogsFor] = useState<DeploymentItem | null>(null);
  const [workflowLogs, setWorkflowLogs] = useState<WorkflowLogsTarget | null>(
    null
  );
  const [resetFor, setResetFor] = useState<DeploymentItem | null>(null);

  const tab: CatalogTab =
    searchParams.get("tab") === "solutions" ? "solutions" : "models";
  const selectedKey = searchParams.get("deployment");
  const deployModelId = searchParams.get("deploy");
  const deploySolution = searchParams.get("solution");
  const resumeModelId = searchParams.get("resume");

  const showCatalog = useCallback(
    () => setSearchParams(tab === "solutions" ? { tab } : {}),
    [setSearchParams, tab]
  );
  const select = useCallback(
    (item: DeploymentItem) => setSearchParams({ deployment: item.key }),
    [setSearchParams]
  );

  // a deploy's card is keyed by its job until its container exists; follow it
  const lastSelected = useRef<DeploymentItem | null>(null);
  const selected = useMemo(() => {
    if (!selectedKey) return null;
    const allItems = [...groupedItems, ...items];
    return (
      allItems.find((i) => i.key === selectedKey) ??
      allItems.find((i) => i.jobId === selectedKey) ??
      groupedItems.find((g) => g.members?.some((m) => m.key === selectedKey)) ??
      null
    );
  }, [selectedKey, groupedItems, items]);

  useEffect(() => {
    if (selected) {
      lastSelected.current = selected;
      if (selected.key !== selectedKey) {
        setSearchParams({ deployment: selected.key }, { replace: true });
      }
      return;
    }
    // the job finished and its container is coming up under a new key
    const previous = lastSelected.current;
    if (selectedKey && previous && !previous.members) {
      const successor = items.find(
        (i) => i.modelName === previous.modelName && i.key !== previous.key
      );
      if (successor)
        setSearchParams({ deployment: successor.key }, { replace: true });
    }
  }, [selected, selectedKey, items, setSearchParams]);

  // `?resume=<model id>` (from the CLI, or the old wizard) opens that deploy
  useEffect(() => {
    if (!resumeModelId) return;
    const item = items.find((i) => i.catalogModelId === resumeModelId);
    if (item) setSearchParams({ deployment: item.key }, { replace: true });
  }, [resumeModelId, items, setSearchParams]);

  const findCatalogModel = useCallback(
    (item: DeploymentItem): CatalogModel | undefined =>
      catalog.data?.find((m) => m.id === item.catalogModelId) ??
      catalog.data?.find((m) => m.name === item.modelName),
    [catalog.data]
  );

  const redeploy = useCallback(
    (item: DeploymentItem) => {
      const model = findCatalogModel(item);
      if (!model) {
        addToast({
          variant: "danger",
          content: `${item.modelName} isn't in the model catalog, so it can't be redeployed from here.`,
        });
        return;
      }
      deploy.mutate(buildAutoDeployRequest(model, chipStatus), {
        onSuccess: (result) => {
          addToast({
            variant: "success",
            content: `Redeploying ${model.name}`,
            timeout: 4000,
          });
          setSearchParams({ deployment: result.jobId });
        },
        onError: (err) =>
          addToast({ variant: "danger", content: describeDeployError(err) }),
      });
    },
    [findCatalogModel, deploy, chipStatus, setSearchParams]
  );

  const cancel = useCallback(
    (item: DeploymentItem) => {
      // once a container exists, stopping it is how a deploy is cancelled
      if (!item.members && item.containerId) {
        setStopping({ item, redeploy: false });
        return;
      }
      for (const target of item.members ?? [item]) {
        if (target.containerId) {
          void deleteModel(target.containerId).catch(() => undefined);
        } else if (target.jobId) {
          void cancelDeployment(target.jobId);
          removeDeployment(target.jobId);
        }
      }
      if (item.members) removeGroup(item.key.slice(SOLUTION_KEY_PREFIX.length));
      addToast({
        variant: "default",
        content: `Cancelled ${item.modelName}`,
        timeout: 4000,
      });
      if (selectedKey === item.key) showCatalog();
    },
    [removeDeployment, removeGroup, selectedKey, showCatalog]
  );

  const dismissItem = useCallback(
    (item: DeploymentItem) => {
      (item.members ?? [item]).forEach(dismiss);
      if (selectedKey === item.key) showCatalog();
    },
    [dismiss, selectedKey, showCatalog]
  );

  const retry = useCallback(
    (item: DeploymentItem) => {
      dismiss(item);
      redeploy(item);
    },
    [dismiss, redeploy]
  );

  const openLogs = useCallback((item: DeploymentItem) => {
    if (item.containerId && item.state !== "error") {
      setLogsFor(item);
    } else if (item.historyId) {
      setWorkflowLogs({
        deploymentId: item.historyId,
        modelName: item.modelName,
        diedUnexpectedly: item.state === "error",
      });
    }
  }, []);

  const stopSolution = useCallback(
    async (item: DeploymentItem) => {
      const members = (item.members ?? []).filter((m) => m.containerId);
      const toast = addToast({
        variant: "loading",
        content: `Stopping ${item.modelName}…`,
      });
      try {
        for (const member of members) {
          await deleteModel(member.containerId!);
        }
        toast.update({
          variant: "success",
          content: `Stopped ${item.modelName}`,
          timeout: 4000,
        });
        removeGroup(item.key.slice(SOLUTION_KEY_PREFIX.length));
        if (selectedKey === item.key) showCatalog();
      } catch (err) {
        toast.update({ variant: "danger", content: getErrorMessage(err) });
      } finally {
        refreshModels();
      }
    },
    [refreshModels, removeGroup, selectedKey, showCatalog]
  );

  const menuItemsFor = useCallback(
    (item: DeploymentItem): MenuItemProps[] => {
      if (item.members) {
        return [
          { text: "View details", onSelect: () => select(item) },
          {
            text: "Stop all",
            style: "danger",
            onSelect: () => void stopSolution(item),
          },
        ];
      }
      const menu: MenuItemProps[] = [];
      if (item.state === "active" && item.containerId) {
        for (const demo of getDemosForModelType(item.modelType)) {
          menu.push({
            text: `Open ${demo.label}`,
            onSelect: () =>
              navigate(demo.href, {
                state: {
                  containerID: item.containerId,
                  modelName: item.modelName,
                },
              }),
          });
        }
        menu.push({
          text: "API",
          onSelect: () =>
            navigate(`/api-info/${encodeURIComponent(item.containerId!)}`),
        });
      }
      if (item.containerId || item.historyId) {
        menu.push({ text: "Logs", onSelect: () => openLogs(item) });
      }
      if (item.containerId && !item.dead) {
        menu.push({
          text: "Stop container",
          style: "danger",
          onSelect: () => setStopping({ item, redeploy: false }),
        });
      }
      return menu;
    },
    [navigate, openLogs, select, stopSolution]
  );

  const deployModel =
    deployModelId && catalog.data
      ? catalog.data.find((m) => m.id === deployModelId)
      : undefined;

  let view: ReactNode;
  if (selectedKey) {
    view = (
      <DrillDown onBack={showCatalog}>
        {selected?.members ? (
          <SolutionDetail
            item={selected}
            onCancel={() => cancel(selected)}
            onStop={() => void stopSolution(selected)}
            onOpenLogs={openLogs}
          />
        ) : selected ? (
          <DeploymentDetail
            item={selected}
            demos={getDemosForModelType(selected.modelType)}
            onCancel={() => cancel(selected)}
            onRetry={() => retry(selected)}
            onDismiss={() => dismissItem(selected)}
            onStop={() => setStopping({ item: selected, redeploy: false })}
            onReset={() => setResetFor(selected)}
            onOpenLogs={() => openLogs(selected)}
          />
        ) : isLoading ? null : (
          <div className="flex flex-col items-center gap-vesper-4 py-vesper-16 text-center">
            <EmptyPill>This deployment is no longer running</EmptyPill>
            <Typography
              variant="copy-sm"
              className="text-vesper-text-secondary"
            >
              It may have been stopped or cancelled.
            </Typography>
          </div>
        )}
      </DrillDown>
    );
  } else if (deploySolution) {
    view = (
      <DrillDown onBack={showCatalog}>
        <DeploySolution onGroupCreated={addGroup} />
      </DrillDown>
    );
  } else if (deployModelId) {
    view = (
      <DrillDown onBack={showCatalog}>
        {deployModel ? (
          <DeployModel key={deployModel.id} model={deployModel} />
        ) : catalog.isPending ? null : (
          <div className="flex justify-center py-vesper-16">
            <EmptyPill>This model isn't in the catalog</EmptyPill>
          </div>
        )}
      </DrillDown>
    );
  } else {
    view = (
      <Catalog
        tab={tab}
        onTabChange={(next) =>
          setSearchParams(next === "solutions" ? { tab: next } : {})
        }
        deployments={items}
        onSelectModel={(model) => setSearchParams({ deploy: model.id })}
        onSelectDeployment={select}
        onSelectSolution={() => setSearchParams({ solution: "voice-agent" })}
      />
    );
  }

  return (
    <div className="h-full flex text-left">
      <DeploymentsPanel
        items={groupedItems}
        loading={isLoading}
        chipStatus={chipStatus}
        selectedKey={selected?.key ?? null}
        menuItemsFor={menuItemsFor}
        onSelect={select}
        onCancel={cancel}
        onRetry={retry}
        onDismiss={dismissItem}
        onRemoveAndRedeploy={(item) => {
          // a dead container has nothing left to stop
          if (item.dead) {
            dismissItem(item);
            redeploy(item);
          } else {
            setStopping({ item, redeploy: true });
          }
        }}
      />
      <div className="flex-1 min-w-0 h-full overflow-auto">{view}</div>

      <StopDeploymentModal
        item={stopping?.item ?? null}
        onClose={() => setStopping(null)}
        onStopped={(item) => {
          dismiss(item);
          if (stopping?.redeploy) redeploy(item);
          else if (selectedKey === item.key) showCatalog();
        }}
      />
      <ResetHardwareModal
        open={resetFor !== null}
        onOpenChange={(open) => {
          if (!open) setResetFor(null);
        }}
        initialSlot={resetFor?.deviceIds[0] ?? null}
        onResetFinished={() => {
          if (resetFor) dismissItem(resetFor);
        }}
      />
      <ContainerLogsModal
        open={logsFor !== null}
        onOpenChange={(open) => {
          if (!open) setLogsFor(null);
        }}
        containerId={logsFor?.containerId ?? null}
        modelName={logsFor?.modelName}
      />
      <WorkflowLogsModal
        target={workflowLogs}
        onClose={() => setWorkflowLogs(null)}
      />
    </div>
  );
}

function DrillDown({
  onBack,
  children,
}: {
  onBack(): void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full flex flex-col p-vesper-4">
      <BackButton onClick={onBack} className="self-start" />
      <div className="flex-1 flex flex-col justify-center px-vesper-6">
        {children}
      </div>
    </div>
  );
}
