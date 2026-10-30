// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Admonition } from "@tenstorrent/vesper/admonition";
import { Button } from "@tenstorrent/vesper/button";
import { Reset } from "@tenstorrent/vesper/icons";
import { Typography } from "@tenstorrent/vesper/typography";
import { useIsResetting } from "@/src/hooks/useIsResetting";
import { useRefresh } from "@/src/hooks/useRefresh";
import { DEPLOYMENTS_PATH } from "@/src/routes/route-config";
import { ContainerLogsModal } from "@/src/vesper/components/container-logs-modal";
import { EmptyPill } from "@/src/vesper/components/empty-pill";
import { ResetHardwareModal } from "@/src/vesper/components/reset-hardware-modal";
import {
  WorkflowLogsModal,
  type WorkflowLogsTarget,
} from "@/src/vesper/components/workflow-logs-modal";
import {
  useHardware,
  type HardwareDevice,
} from "@/src/vesper/hooks/use-hardware";
import { CardGroup } from "./components/card-group";
import {
  DetectingHardware,
  ResettingHardware,
} from "./components/detecting-hardware";

export default function HardwarePage() {
  const location = useLocation();
  const hardware = useHardware();
  const isResetting = useIsResetting();
  const { triggerHardwareRefresh } = useRefresh();

  const [resetOpen, setResetOpen] = useState(false);
  const [resetSlot, setResetSlot] = useState<number | null>(null);
  const [logsFor, setLogsFor] = useState<HardwareDevice | null>(null);
  const [workflowLogs, setWorkflowLogs] = useState<WorkflowLogsTarget | null>(
    null
  );

  // `python run.py run <model>` and the old deploy wizard link here with
  // `?auto-deploy=` / `?resume=`, which the deployments page now handles
  const search = new URLSearchParams(location.search);
  if (search.has("auto-deploy") || search.has("resume")) {
    return <Navigate to={`${DEPLOYMENTS_PATH}${location.search}`} replace />;
  }

  const openReset = (slot: number | null) => {
    setResetSlot(slot);
    setResetOpen(true);
  };

  const viewLogs = (device: HardwareDevice) => {
    const deployment = device.deployment;
    if (!deployment) return;
    if (deployment.containerId && deployment.state !== "error") {
      setLogsFor(device);
    } else if (deployment.historyId) {
      setWorkflowLogs({
        deploymentId: deployment.historyId,
        modelName: deployment.modelName,
        diedUnexpectedly: deployment.state === "error",
      });
    }
  };

  return (
    <div className="min-h-full flex flex-col text-left">
      <div className="flex items-center justify-end gap-vesper-5 p-vesper-6">
        <Button
          type="button"
          size="sm"
          variant="tertiary"
          disabled={isResetting || hardware.cards.length === 0}
          onClick={() => openReset(null)}
        >
          Master reset
        </Button>
        <Button
          type="button"
          size="sm"
          variant="subtle"
          iconLeft={<Reset />}
          onClick={() => {
            void triggerHardwareRefresh();
            hardware.rescan();
          }}
        >
          Re-scan
        </Button>
      </div>

      {hardware.isDetecting ? (
        <DetectingHardware />
      ) : hardware.cards.length === 0 && isResetting ? (
        // the backend reports no devices while a reset runs
        <ResettingHardware />
      ) : hardware.cards.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-vesper-4 p-vesper-10 text-center">
          <EmptyPill>No Tenstorrent hardware detected</EmptyPill>
          <Typography
            variant="copy-sm"
            className="max-w-md text-vesper-text-secondary"
          >
            {hardware.error
              ? `Couldn't read the hardware state: ${hardware.error}`
              : "Check that the card is seated and its driver is loaded, then re-scan."}
          </Typography>
        </div>
      ) : (
        <div className="flex flex-col gap-vesper-8 px-vesper-10 pb-vesper-16 pt-vesper-12">
          {(hardware.boardState === "BAD_STATE" || hardware.resetSuggested) && (
            <Admonition
              variant="danger"
              className="max-w-3xl w-full mx-auto"
              ctaAs="button"
              cta={{ children: "Reset", onClick: () => openReset(null) }}
            >
              The board is in a bad state. Reset it before deploying a model.
            </Admonition>
          )}
          {isResetting && (
            <Admonition variant="info" className="max-w-3xl w-full mx-auto">
              A board reset is in progress. This takes about a minute or two.
            </Admonition>
          )}
          <div className="flex flex-wrap justify-center gap-x-vesper-16 gap-y-vesper-12">
            {hardware.cards.map((card) => (
              <CardGroup
                key={card.index}
                card={card}
                onReset={(device) => openReset(device.slot)}
                onViewLogs={viewLogs}
              />
            ))}
          </div>
        </div>
      )}

      <ResetHardwareModal
        open={resetOpen}
        onOpenChange={setResetOpen}
        initialSlot={resetSlot}
      />
      <ContainerLogsModal
        open={logsFor !== null}
        onOpenChange={(open) => {
          if (!open) setLogsFor(null);
        }}
        containerId={logsFor?.deployment?.containerId ?? null}
        modelName={logsFor?.deployment?.modelName}
      />
      <WorkflowLogsModal
        target={workflowLogs}
        onClose={() => setWorkflowLogs(null)}
      />
    </div>
  );
}
