// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ChevronRight, File, Folder, ExternalLink } from "lucide-react";

const logsAPIURL = "/logs-api/";

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
        const organizedLogs = filterEmptyFolders(data.logs);
        setLogs(organizedLogs);
      } catch (error) {
        console.error("Error fetching logs:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  const filterEmptyFolders = (nodes: LogFile[]): LogFile[] => {
    return nodes.filter((node) => {
      if (node.type === "directory") {
        node.children = filterEmptyFolders(node.children || []);
        return node.children.length > 0;
      }
      return true;
    });
  };

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
    const encodedLogName = encodeURIComponent(logName);
    const logUrl = `${logsAPIURL}${encodedLogName}/`;
    window.open(logUrl, "_blank", "noopener,noreferrer");
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
          <div key={currentPath} className="mb-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start px-2 py-1.5 h-auto hover:bg-accent hover:text-accent-foreground rounded-md transition-colors duration-200"
              onClick={() => toggleDir(currentPath)}
            >
              <ChevronRight
                className={`h-4 w-4 mr-2 transition-transform duration-200 flex-shrink-0 ${
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
            className="w-full justify-start px-2 py-1.5 h-auto mb-1 hover:bg-accent hover:text-accent-foreground group rounded-md transition-colors duration-200"
            onClick={() => openLogInNewTab(currentPath.slice(1))}
          >
            <File className="h-4 w-4 mr-2 flex-shrink-0 text-blue-500" />
            <div className="text-sm truncate text-left flex-grow">
              {formatFileName(node.name)}
            </div>
            <ExternalLink className="h-4 w-4 ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
          </Button>
        );
      }
    });
  };

  return (
    <div className="flex flex-col overflow-auto w-full max-w-4xl mx-auto p-4">
      <Card className="flex flex-col w-full h-full shadow-lg">
        <CardHeader className="bg-background sticky top-0 z-10">
          <CardTitle className="text-2xl font-bold">Log Files</CardTitle>
        </CardHeader>
        <CardContent className="flex-grow overflow-hidden pt-4">
          <ScrollArea className="h-[calc(100vh-200px)] w-full pr-4">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-lg text-muted-foreground">Loading logs...</p>
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
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
