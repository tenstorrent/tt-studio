// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from "react";
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
  Settings,
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
}: Props): JSX.Element {
  const { containerId, image, ports } = visibleMap;
  return (
    <>
      <TableHeader>
        <TableRow className="bg-stone-50/70 dark:bg-stone-900/40 border-b-2 border-stone-200 dark:border-stone-800">
          {containerId && (
            <TableHead className="text-left font-semibold">
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
          <TableHead className="text-left font-semibold">
            <Tag
              className="inline-block mr-2 text-TT-purple-accent"
              size={16}
            />
            Model Name
          </TableHead>
          {image && (
            <TableHead className="text-left font-semibold">
              <div className="flex items-center">
                <ImageIcon
                  className="inline-block mr-2 text-TT-purple-accent"
                  size={16}
                />
                Image
              </div>
            </TableHead>
          )}
          <TableHead className="text-left font-semibold">
            <Activity
              className="inline-block mr-2 text-TT-purple-accent"
              size={16}
            />
            Status
          </TableHead>
          <TableHead className="text-left font-semibold">
            <Heart
              className="inline-block mr-2 text-TT-purple-accent"
              size={16}
            />
            Health
          </TableHead>
          {ports && (
            <TableHead className="text-left font-semibold">
              <div className="flex items-center">
                <Network
                  className="inline-block mr-2 text-TT-purple-accent"
                  size={16}
                />
                Ports
              </div>
            </TableHead>
          )}
          <TableHead className="text-center font-semibold">
            <Settings
              className="inline-block mr-2 text-TT-purple-accent"
              size={16}
            />
            Manage
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            className="transition-all duration-1000 hover:bg-stone-50 dark:hover:bg-stone-900/30 border-b border-stone-200 dark:border-stone-800 rounded-lg"
          >
            {containerId ? (
              <TableCell className="text-left">
                <ContainerLogsCell id={row.id} onOpenLogs={onOpenLogs} />
              </TableCell>
            ) : null}
            <TableCell className="text-left">
              <ModelNameCell name={row.name} />
            </TableCell>
            {image ? (
              <TableCell className="text-left">
                <ImageCell image={row.image} />
              </TableCell>
            ) : null}
            <TableCell className="text-left">
              <StatusCell status={row.status} />
            </TableCell>
            <TableCell className="text-left">
              <HealthCell
                id={row.id}
                register={registerHealthRef}
                onHealthChange={onHealthChange}
              />
            </TableCell>
            {ports ? (
              <TableCell className="text-left">
                <PortsCell ports={row.ports} />
              </TableCell>
            ) : null}
            <TableCell className="text-center">
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
        ))}
      </TableBody>
    </>
  );
}
