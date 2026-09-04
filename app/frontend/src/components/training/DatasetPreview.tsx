// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useState } from "react";
import { Table2, Braces } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { formatCellValue, type DatasetPreview as DatasetPreviewData } from "./datasetPreview";

interface DatasetPreviewProps {
  preview: DatasetPreviewData;
  /** How many rows to render in the preview. */
  maxRows?: number;
}

type ViewMode = "table" | "json";

export function DatasetPreview({ preview, maxRows = 5 }: DatasetPreviewProps) {
  const [view, setView] = useState<ViewMode>("table");

  const sampleRows = useMemo(
    () => preview.rows.slice(0, maxRows),
    [preview.rows, maxRows],
  );

  const shownCount = sampleRows.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Showing {shownCount.toLocaleString()} of{" "}
          {preview.totalRows.toLocaleString()} rows &middot;{" "}
          {preview.columns.length.toLocaleString()} columns
        </p>
        <div className="flex items-center rounded-md border border-gray-200 p-0.5 dark:border-gray-700">
          <Button
            type="button"
            variant={view === "table" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            onClick={() => setView("table")}
          >
            <Table2 className="h-4 w-4" />
            Table
          </Button>
          <Button
            type="button"
            variant={view === "json" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 px-2.5"
            onClick={() => setView("json")}
          >
            <Braces className="h-4 w-4" />
            JSON
          </Button>
        </div>
      </div>

      {view === "table" ? (
        <div className="max-h-96 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800">
              <TableRow>
                {preview.columns.map((col) => (
                  <TableHead
                    key={col}
                    className="whitespace-nowrap font-mono text-xs"
                  >
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sampleRows.map((row, idx) => (
                <TableRow key={idx}>
                  {preview.columns.map((col) => {
                    const text = formatCellValue(row[col]);
                    return (
                      <TableCell
                        key={col}
                        className="max-w-xs align-top text-xs"
                        title={text}
                      >
                        <span className="line-clamp-3 whitespace-pre-wrap break-words">
                          {text}
                        </span>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <pre
          className={cn(
            "max-h-96 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-left text-xs leading-relaxed",
            "dark:border-gray-700 dark:bg-gray-900/50",
          )}
        >
          <code>{JSON.stringify(sampleRows, null, 2)}</code>
        </pre>
      )}
    </div>
  );
}
