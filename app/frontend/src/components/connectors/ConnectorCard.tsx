// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Loader2, Plug, Plus, X } from "lucide-react";

import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import type {
  AvailableConnector,
  Connection,
} from "../../types/connectors";

interface Props {
  connector: AvailableConnector;
  connection: Connection | null;
  pending: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

const ACTIVE_STATUSES = new Set(["ACTIVE", "INITIATED", "INITIALIZING"]);

export function ConnectorCard({
  connector,
  connection,
  pending,
  onConnect,
  onDisconnect,
}: Props) {
  const isConnected =
    !!connection && ACTIVE_STATUSES.has(String(connection.status));
  const isActive = String(connection?.status || "") === "ACTIVE";

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
          {connector.icon_url ? (
            <img
              src={connector.icon_url}
              alt={connector.name}
              className="h-7 w-7 object-contain"
              loading="lazy"
            />
          ) : (
            <Plug className="h-5 w-5" />
          )}
        </div>
        <div className="flex flex-col">
          <CardTitle className="text-base">{connector.name}</CardTitle>
          {!connector.configured && (
            <span className="mt-1 inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              Not configured on server
            </span>
          )}
          {isActive && connector.configured && (
            <span className="mt-1 inline-flex w-fit items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
              Connected
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <CardDescription className="flex-1 text-sm">
          {connector.description}
        </CardDescription>
        {isConnected ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDisconnect}
            disabled={pending}
            className="w-fit"
          >
            {pending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="mr-1 h-3.5 w-3.5" />
            )}
            Disconnect
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={onConnect}
            disabled={pending || !connector.configured}
            className="w-fit"
            title={
              connector.configured
                ? undefined
                : "Server admin must register an auth config for this connector."
            }
          >
            {pending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1 h-3.5 w-3.5" />
            )}
            Connect
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
