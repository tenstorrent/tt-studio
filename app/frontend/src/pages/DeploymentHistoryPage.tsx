// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Skeleton } from "../components/ui/skeleton";
import { Button } from "../components/ui/button";
import { AlertCircle, RefreshCw, FileText } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import WorkflowLogDialog from "../components/deployment/WorkflowLogDialog";

interface Deployment {
  id: number;
  container_id: string;
  container_name: string;
  model_name: string;
  device: string;
  deployed_at: string;
  stopped_at: string | null;
  status: string;
  stopped_by_user: boolean;
  port: number | null;
  workflow_log_path: string | null;
}

interface DeploymentHistoryResponse {
  status: string;
  deployments: Deployment[];
  count: number;
}

const fetchDeploymentHistory = async (): Promise<DeploymentHistoryResponse> => {
  const response = await axios.get<DeploymentHistoryResponse>(
    "/docker-api/deployment-history/"
  );
  return response.data;
};

const getStatusBadge = (status: string, stoppedByUser: boolean) => {
  if (status === "running") {
    return <Badge className="bg-green-500">Running</Badge>;
  }
  if (status === "stopped" && stoppedByUser) {
    return <Badge variant="secondary">Stopped by User</Badge>;
  }
  if (status === "exited" || status === "dead") {
    return <Badge variant="destructive">Died Unexpectedly</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
};

const formatDate = (dateString: string | null) => {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleString();
};

const formatDuration = (deployedAt: string, stoppedAt: string | null) => {
  if (!stoppedAt) return "Still running";
  
  const deployed = new Date(deployedAt);
  const stopped = new Date(stoppedAt);
  const durationMs = stopped.getTime() - deployed.getTime();
  
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

export default function DeploymentHistoryPage() {
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<number | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string | undefined>(undefined);
  
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["deploymentHistory"],
    queryFn: fetchDeploymentHistory,
    refetchInterval: 5000, // Refetch every 5 seconds for near real-time updates
    refetchOnMount: "always", // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window regains focus
  });

  const handleOpenLogs = (deployment: Deployment) => {
    if (deployment.workflow_log_path) {
      setSelectedDeploymentId(deployment.id);
      setSelectedModelName(deployment.model_name);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold">
                Deployment History
              </CardTitle>
              <p className="text-muted-foreground">
                View all model deployments and their status
              </p>
            </div>
            <Button
              onClick={() => refetch()}
              disabled={isFetching}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                Failed to load deployment history. Please try again later.
              </AlertDescription>
            </Alert>
          )}

          {data && data.deployments.length === 0 && (
            <Alert>
              <AlertDescription>
                No deployments found. Deploy a model to see it here.
              </AlertDescription>
            </Alert>
          )}

          {data && data.deployments.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model Name</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>Container Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Deployed At</TableHead>
                    <TableHead>Stopped At</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Port</TableHead>
                    <TableHead>Logs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.deployments.map((deployment) => (
                    <TableRow key={deployment.id}>
                      <TableCell className="font-medium">
                        {deployment.model_name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{deployment.device}</Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {deployment.container_name}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(
                          deployment.status,
                          deployment.stopped_by_user
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDate(deployment.deployed_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDate(deployment.stopped_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDuration(
                          deployment.deployed_at,
                          deployment.stopped_at
                        )}
                      </TableCell>
                      <TableCell>
                        {deployment.port ? (
                          <code className="text-xs">{deployment.port}</code>
                        ) : (
                          "N/A"
                        )}
                      </TableCell>
                      <TableCell>
                        {deployment.workflow_log_path ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenLogs(deployment)}
                            className="gap-2"
                          >
                            <FileText className="h-4 w-4" />
                            See Logs
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {data && (
            <p className="text-sm text-muted-foreground mt-4">
              Total deployments: {data.count}
            </p>
          )}
        </CardContent>
      </Card>

      <WorkflowLogDialog
        open={selectedDeploymentId !== null}
        deploymentId={selectedDeploymentId}
        modelName={selectedModelName}
        onClose={() => {
          setSelectedDeploymentId(null);
          setSelectedModelName(undefined);
        }}
      />
    </div>
  );
}

