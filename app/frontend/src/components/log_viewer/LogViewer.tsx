// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Card, CardContent } from "../ui/card";
import { ChevronRight, File, Folder, ExternalLink } from "lucide-react";

const logsAPIURL = "/logs-api/"; // Proxied API path for logs

interface LogFile {
  name: string;
  type: "file" | "directory";
  children?: LogFile[];
}

export default function LogsViewer() {
  const [logs, setLogs] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await fetch(logsAPIURL);
        const data = await response.json();
        const organizedLogs = data.logs;
        setLogs(organizedLogs);
      } catch (error) {
        console.error("Error fetching logs:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

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

  const openLogInNewTab = (logName: string) => {
    const encodedLogName = encodeURIComponent(logName); // Ensure proper encoding of the log name
    const logUrl = `${logsAPIURL}${encodedLogName}/`; // Construct URL to the backend API, notice the '/' at the end
    window.open(logUrl, "_blank", "noopener,noreferrer"); // Open in a new tab
  };

  const formatFileName = (name: string) => {
    const parts = name.split("_");
    if (parts.length > 2) {
      const date = parts[0];
      const time = parts[1].replace(/-/g, ":");
      const rest = parts.slice(2).join("_");
      return (
        <div className="flex flex-col">
          <span className="font-medium">{rest}</span>
          <span className="text-xs text-muted-foreground">{`${date} ${time}`}</span>
        </div>
      );
    }
    return name;
  };

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
              className="w-full justify-start px-2 py-1 h-auto hover:bg-accent hover:text-accent-foreground"
              onClick={() => toggleDir(currentPath)}
            >
              <ChevronRight
                className={`h-4 w-4 mr-2 transition-transform flex-shrink-0 ${
                  isExpanded ? "rotate-90" : ""
                }`}
              />
              <Folder className="h-4 w-4 mr-2 flex-shrink-0 text-yellow-500" />
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
            className="w-full justify-start px-2 py-1 h-auto mb-1 hover:bg-accent hover:text-accent-foreground group"
            onClick={() => openLogInNewTab(currentPath.slice(1))} // Calls backend API
          >
            <File className="h-4 w-4 mr-2 flex-shrink-0 text-blue-500" />
            <div className="text-sm truncate text-left flex-grow">
              {formatFileName(node.name)}
            </div>
            <ExternalLink className="h-4 w-4 ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </Button>
        );
      }
    });
  };

  return (
    <div className="flex flex-col overflow-auto w-10/12 mx-auto">
      <Card className="flex flex-col w-full h-full">
        <div className="bg-gray-200 dark:bg-gray-800 rounded-lg p-4 shadow-lg dark:shadow-2xl sticky top-0 z-10 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Log Files</h2>
          <p className="text-sm text-muted-foreground">
            Select a log file to view its contents in a new tab.
          </p>
        </div>
        <CardContent className="flex-grow overflow-hidden">
          <ScrollArea className="h-[calc(100vh-150px)] w-full">
            <div className="p-4">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading logs...</p>
              ) : (
                renderTree(logs)
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
