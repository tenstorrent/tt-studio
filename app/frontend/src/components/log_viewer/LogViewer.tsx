// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Card, CardContent } from "../ui/card";
import {
  ChevronRight,
  File,
  Folder,
  ExternalLink,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { openEncodedLogInNewTab } from "./openEncodedLogInNewTab";
import { parseLogFileName } from "./parseLogFileName";

export const logsAPIURL = "/logs-api/";

interface LogFile {
  name: string;
  type: "file" | "directory";
  children?: LogFile[];
}

export default function LogsViewer() {
  const [logs, setLogs] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const filterLogsAndEmptyDirs = useCallback((nodes: LogFile[]): LogFile[] => {
    return nodes.filter((node) => {
      if (node.type === "directory") {
        node.children = filterLogsAndEmptyDirs(node.children || []);
        return node.children.length > 0;
      }
      return node.name.toLowerCase().includes("log");
    });
  }, []);

  const extractDateFromFileName = (fileName: string) => {
    // Adjusted regex to match 'YYYY-MM-DD-HH_MM_SS' format in log files
    const match = fileName.match(
      /(\d{4})-(\d{2})-(\d{2})-(\d{2})_(\d{2})_(\d{2})/
    );
    if (match) {
      const [year, month, day, hour, minute, second] = match
        .slice(1)
        .map(Number);
      return new Date(year, month - 1, day, hour, minute, second); // Create a valid Date object
    }
    return null;
  };

  const sortLogs = useCallback(
    (nodes: LogFile[]) => {
      return [...nodes].sort((a, b) => {
        const dateA = extractDateFromFileName(a.name);
        const dateB = extractDateFromFileName(b.name);

        if (!dateA || !dateB) {
          return sortOrder === "asc"
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        }

        return sortOrder === "asc"
          ? dateA.getTime() - dateB.getTime()
          : dateB.getTime() - dateA.getTime();
      });
    },
    [sortOrder]
  );

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await fetch(logsAPIURL);
        const data = await response.json();
        let filteredLogs = filterLogsAndEmptyDirs(data.logs);
        filteredLogs = sortLogs(filteredLogs);
        setLogs(filteredLogs);
      } catch (error) {
        console.error("Error fetching logs:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [filterLogsAndEmptyDirs, sortLogs]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const openLogInNewTab = openEncodedLogInNewTab();

  const formatFileName = parseLogFileName();

  const renderTree = (nodes: LogFile[], path: string = "") => {
    return nodes.map((node) => {
      const currentPath = `${path}/${node.name}`;
      const isExpanded = expandedDirs.has(currentPath);

      if (node.type === "directory") {
        return (
          <div key={currentPath} className="mb-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start px-2 py-1.5 h-auto hover:bg-accent hover:text-accent-foreground rounded-md transition-colors duration-200"
              onClick={() => toggleDir(currentPath)}
            >
              <ChevronRight
                className={`h-4 w-4 mr-2 transition-transform duration-200 shrink-0 ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
              <Folder className="h-4 w-4 mr-2 shrink-0 text-yellow-500" />
              <span className="text-sm font-medium truncate">{node.name}</span>
            </Button>
            {isExpanded && node.children && (
              <div className="ml-4 mt-1 border-l border-border pl-2">
                {renderTree(node.children, currentPath)}
              </div>
            )}
          </div>
        );
      } else {
        return (
          <Button
            key={currentPath}
            variant="ghost"
            size="sm"
            className="w-full justify-start px-2 py-1.5 h-auto mb-1 hover:bg-accent hover:text-accent-foreground group rounded-md transition-colors duration-200"
            onClick={() => openLogInNewTab(currentPath.slice(1))}
          >
            <File className="h-4 w-4 mr-2 shrink-0 text-blue-500" />
            <div className="text-sm truncate text-left grow">
              {formatFileName(node.name)}
            </div>
            <ExternalLink className="h-4 w-4 ml-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
          </Button>
        );
      }
    });
  };

  const toggleSortOrder = () => {
    setSortOrder((prevOrder) => (prevOrder === "asc" ? "desc" : "asc"));
  };

  return (
    <div className="flex flex-col overflow-auto w-10/12 mx-auto">
      <Card className="flex flex-col w-full h-full shadow-lg">
        <div className="bg-gray-200 dark:bg-gray-800 rounded-t-lg p-4 shadow-md dark:shadow-2xl sticky top-0 z-10 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Log Files</h2>
          <div className="flex items-center space-x-2">
            <p className="text-sm text-muted-foreground">Sort by date</p>
            <Button variant="ghost" size="sm" onClick={toggleSortOrder}>
              {sortOrder === "asc" ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <CardContent className="grow overflow-hidden">
          <ScrollArea className="h-[calc(100vh-150px)] w-full">
            <div className="p-4">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-lg text-muted-foreground">
                    Loading logs...
                  </p>
                </div>
              ) : logs.length > 0 ? (
                renderTree(logs)
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-lg text-muted-foreground">
                    No log files found.
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
