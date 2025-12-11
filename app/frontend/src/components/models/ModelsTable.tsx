// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
import type { JSX } from "react";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import {
  Activity,
  Heart,
  Network,
  // Settings,
  Tag,
  Image as ImageIcon,
  FileText,
} from "lucide-react";
import type {
  ColumnVisibilityMap,
  ModelRow,
  HealthStatus,
} from "../../types/models";
import ContainerLogsCell from "./row-cells/ContainerLogsCell";
import ModelNameCell from "./row-cells/ModelNameCell";
import ImageCell from "./row-cells/ImageCell";
import StatusCell from "./row-cells/StatusCell";
import HealthCell from "./row-cells/HealthCell";
import PortsCell from "./row-cells/PortsCell";
import ManageCell from "./row-cells/ManageCell";
import CopyableText from "../CopyableText";
import { ChevronDown } from "lucide-react";

interface Props {
  rows: ModelRow[];
  visibleMap: ColumnVisibilityMap;
  healthMap: Record<string, HealthStatus>;
  onOpenLogs: (id: string) => void;
  onDelete: (id: string) => void;
  onRedeploy: (image?: string) => void;
  onNavigateToModel: (id: string, name: string, navigate?: any) => void; // navigate optional for compatibility
  onOpenApi: (id: string) => void;
  registerHealthRef: (id: string, node: any | null) => void;
  onHealthChange: (id: string, h: HealthStatus) => void;
  refreshHealthById?: (id: string) => void;
  density?: "compact" | "normal" | "comfortable";
}

export default function ModelsTable({
  rows,
  visibleMap,
  onOpenLogs,
  onDelete,
  onRedeploy,
  onNavigateToModel,
  onOpenApi,
  registerHealthRef,
  healthMap,
  onHealthChange,
  refreshHealthById,
  density = "normal",
}: Props): JSX.Element {
  const { containerId, image, ports } = visibleMap;

  // Listen to hover-tier events for per-row actions
  React.useEffect(() => {
    const onRefresh = (e: Event) => {
      const customEvent = e as CustomEvent;
      const id = customEvent?.detail?.id as string | undefined;
      if (!id) return;
      if (refreshHealthById) refreshHealthById(id);
    };
    const onLogs = (e: Event) => {
      const customEvent = e as CustomEvent;
      const id = customEvent?.detail?.id as string | undefined;
      if (!id) return;
      onOpenLogs(id);
    };
    window.addEventListener("row:refresh-health", onRefresh);
    window.addEventListener("row:logs", onLogs);
    return () => {
      window.removeEventListener("row:refresh-health", onRefresh);
      window.removeEventListener("row:logs", onLogs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowHeightClass = React.useMemo(() => {
    switch (density) {
      case "compact":
        return "h-10";
      case "comfortable":
        return "h-14";
      case "normal":
      default:
        return "h-12";
    }
  }, [density]);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const toggleExpanded = React.useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);
  return (
    <>
      <TableHeader>
        <TableRow className="bg-stone-50/70 dark:bg-stone-900/40 border-b-2 border-stone-200 dark:border-stone-800">
          {containerId && (
            <TableHead className="text-right font-semibold">
              <div className="flex items-center">
                <FileText
                  className="inline-block mr-2 text-TT-purple-accent"
                  size={16}
                />
                Container Logs
                <span className="text-xs font-normal text-TT-purple-accent dark:text-TT-purple">
                  (live monitoring)
                </span>
              </div>
            </TableHead>
          )}
          <TableHead className="text-right font-semibold">
            <Tag
              className="inline-block mr-2 text-TT-purple-accent"
              size={16}
            />
            Model Name
          </TableHead>
          {image && (
            <TableHead className="text-right font-semibold">
              <div className="flex items-center">
                <ImageIcon
                  className="inline-block mr-2 text-TT-purple-accent"
                  size={16}
                />
                Image
              </div>
            </TableHead>
          )}
          <TableHead className="text-right font-semibold">
            <Activity
              className="inline-block mr-2 text-TT-purple-accent"
              size={16}
            />
            Status
          </TableHead>
          <TableHead className="text-right font-semibold">
            <Heart
              className="inline-block mr-2 text-TT-purple-accent"
              size={16}
            />
            Health
          </TableHead>
          {ports && (
            <TableHead className="text-right font-semibold">
              <div className="flex items-center">
                <Network
                  className="inline-block mr-2 text-TT-purple-accent"
                  size={16}
                />
                Ports
              </div>
            </TableHead>
          )}
          <TableHead className="text-right font-semibold">
            {/* <Settings
              className="inline-block text-TT-purple-accent"
              size={16}
            /> */}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const isExpanded = !!expanded[row.id];
          const colCount =
            1 /* name */ +
            1 /* status */ +
            1 /* health */ +
            1 /* manage */ +
            (containerId ? 1 : 0) +
            (image ? 1 : 0) +
            (ports ? 1 : 0);
          return (
            <React.Fragment key={row.id}>
              <TableRow
                className={`transition-all duration-300 hover:bg-stone-50 dark:hover:bg-stone-900/30 border-b border-stone-200 dark:border-stone-800 rounded-lg group ${rowHeightClass}`}
              >
                {containerId ? (
                  <TableCell className="text-right">
                    <ContainerLogsCell id={row.id} onOpenLogs={onOpenLogs} />
                  </TableCell>
                ) : null}
                <TableCell className="text-right">
                  <button
                    className="inline-flex items-center gap-2 text-right hover:text-TT-purple-accent"
                    onClick={() => toggleExpanded(row.id)}
                    title={isExpanded ? "Collapse details" : "Expand details"}
                  >
                    <ChevronDown
                      className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : "rotate-0"}`}
                    />
                    <ModelNameCell name={row.name} />
                  </button>
                </TableCell>
                {image ? (
                  <TableCell className="text-right">
                    <ImageCell image={row.image} />
                  </TableCell>
                ) : null}
                <TableCell className="text-right">
                  <StatusCell status={row.status} />
                </TableCell>
                <TableCell className="text-right">
                  <HealthCell
                    id={row.id}
                    register={registerHealthRef}
                    onHealthChange={onHealthChange}
                  />
                </TableCell>
                {ports ? (
                  <TableCell className="text-right">
                    <PortsCell ports={row.ports} />
                  </TableCell>
                ) : null}
                <TableCell className="text-right">
                  <ManageCell
                    id={row.id}
                    name={row.name}
                    image={row.image}
                    health={healthMap[row.id]}
                    onDelete={onDelete}
                    onRedeploy={onRedeploy}
                    onNavigateToModel={onNavigateToModel}
                    onOpenApi={onOpenApi}
                  />
                </TableCell>
              </TableRow>
              {isExpanded && (
                <TableRow className="bg-stone-50/60 dark:bg-stone-900/30">
                  <TableCell colSpan={colCount}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 text-sm">
                      <div className="min-w-0">
                        <div className="text-xs text-stone-500 mb-1">
                          Container ID
                        </div>
                        <CopyableText text={row.id} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-stone-500 mb-1">Model Name</div>
                        <CopyableText text={row.name ?? ""} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-stone-500 mb-1">
                          Docker Image
                        </div>
                        <CopyableText text={row.image ?? ""} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-stone-500 mb-1">Ports</div>
                        <CopyableText text={row.ports ?? ""} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-stone-500 mb-1">Status</div>
                        <CopyableText text={row.status ?? ""} />
                      </div>
                      <div className="flex items-end">
                        <button
                          className="ml-auto rounded-md border border-TT-purple-accent/30 px-3 py-1.5 text-xs hover:bg-TT-purple-tint2/20 dark:hover:bg-TT-purple-shade/20 transition-colors"
                          onClick={() => {
                            const all = `id: ${row.id}\nname: ${row.name ?? ""}\nimage: ${row.image ?? ""}\nports: ${row.ports ?? ""}\nstatus: ${row.status ?? ""}`;
                            navigator.clipboard.writeText(all);
                          }}
                        >
                          Copy details
                        </button>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          );
        })}
      </TableBody>
    </>
  );
}
