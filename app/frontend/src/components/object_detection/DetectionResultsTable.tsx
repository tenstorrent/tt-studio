// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Detection } from "./types/objectDetection";
import { getConfidenceTextColorClass } from "./utils/colorUtils";
import { Activity, ChevronRight, ChevronDown } from "lucide-react";

interface DetectionResultsTableProps {
  scaledDetections: Detection[];
  hoveredIndex: number | null;
  onHoverDetection: (index: number | null) => void;
}

export const DetectionResultsTable: React.FC<DetectionResultsTableProps> = ({
  scaledDetections,
  hoveredIndex,
  onHoverDetection,
}) => {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (index: number) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  return (
    <div className="h-full flex flex-col p-4">
      {scaledDetections.length > 0 && (
        <div className="grow overflow-hidden flex flex-col bg-background rounded-lg border shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-muted-foreground" />
              <span className="text-sm font-semibold">Detection Results</span>
            </div>
          </div>
          <div className="overflow-y-auto grow">
            <Table className="w-full">
              <TableHeader className="bg-muted/30 sticky top-0 z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[48px] text-center whitespace-nowrap py-3 px-2">
                    Details
                  </TableHead>
                  <TableHead className="w-[100px] text-center whitespace-nowrap py-3">
                    Confidence
                  </TableHead>
                  <TableHead className="text-left whitespace-nowrap py-3 pl-4">
                    Object
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scaledDetections.map((detection, index) => (
                  <React.Fragment key={index}>
                    <TableRow
                      className={`hover:bg-muted/40 transition-colors ${
                        index === hoveredIndex
                          ? "bg-blue-50 dark:bg-blue-900/20"
                          : ""
                      }`}
                      onMouseEnter={() => onHoverDetection(index)}
                      onMouseLeave={() => onHoverDetection(null)}
                    >
                      <TableCell className="text-center py-2 px-2 w-[48px]">
                        <button
                          onClick={() => toggleRow(index)}
                          className="p-1 hover:bg-muted/60 rounded-md transition-colors"
                        >
                          {expandedRows.has(index) ? (
                            <ChevronDown
                              size={16}
                              className="text-muted-foreground"
                            />
                          ) : (
                            <ChevronRight
                              size={16}
                              className="text-muted-foreground"
                            />
                          )}
                        </button>
                      </TableCell>
                      <TableCell
                        className={`text-center font-medium py-2 w-[100px] ${getConfidenceTextColorClass(
                          detection.confidence
                        )}`}
                      >
                        {(detection.confidence * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-left font-medium py-2 pl-4">
                        {detection.name}
                      </TableCell>
                    </TableRow>
                    {expandedRows.has(index) && (
                      <TableRow className="bg-muted/10 border-y border-muted">
                        <TableCell colSpan={3} className="px-6 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                            <div className="space-y-2">
                              <div>
                                <span className="text-muted-foreground">
                                  ID:{" "}
                                </span>
                                <span className="font-medium">
                                  {detection.class}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  x-min:{" "}
                                </span>
                                <span className="font-mono">
                                  {detection.xmin?.toFixed(3)}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div>
                                <span className="text-muted-foreground">
                                  y-min:{" "}
                                </span>
                                <span className="font-mono">
                                  {detection.ymin?.toFixed(3)}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">
                                  x-max:{" "}
                                </span>
                                <span className="font-mono">
                                  {detection.xmax?.toFixed(3)}
                                </span>
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div>
                                <span className="text-muted-foreground">
                                  y-max:{" "}
                                </span>
                                <span className="font-mono">
                                  {detection.ymax?.toFixed(3)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
};
