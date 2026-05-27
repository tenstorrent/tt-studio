// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import {
  ConnectorsApiError,
  disconnectConnector,
  listAvailable,
  listConnections,
} from "../../api/connectorsApi";
import type { AvailableConnector, Connection } from "../../types/connectors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

import { ConnectorCard } from "./ConnectorCard";
import { useConnectorOAuth } from "./useConnectorOAuth";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectorsDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"connectors" | "skills" | "plugins">("connectors");

  const availableQuery = useQuery({
    queryKey: ["connectors", "available"],
    queryFn: listAvailable,
    enabled: open,
    staleTime: 60_000,
  });

  const connectionsQuery = useQuery({
    queryKey: ["connectors", "connections"],
    queryFn: listConnections,
    enabled: open,
    staleTime: 10_000,
  });

  const { connect } = useConnectorOAuth();

  const connectMutation = useMutation({
    mutationFn: async (slug: string) => connect(slug),
    onSuccess: (result) => {
      if (result.status === "success") {
        toast.success(`${result.provider} connected`);
      } else {
        toast.error(`${result.provider} connection failed: ${result.error || ""}`);
      }
      queryClient.invalidateQueries({ queryKey: ["connectors", "connections"] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof ConnectorsApiError || e instanceof Error
        ? e.message
        : "Failed to start OAuth";
      toast.error(msg);
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (slug: string) => disconnectConnector(slug),
    onSuccess: (_count, slug) => {
      toast.success(`${slug} disconnected`);
      queryClient.invalidateQueries({ queryKey: ["connectors", "connections"] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof ConnectorsApiError || e instanceof Error
        ? e.message
        : "Failed to disconnect";
      toast.error(msg);
    },
  });

  const connectionByProvider = useMemo(() => {
    const map = new Map<string, Connection>();
    for (const c of connectionsQuery.data ?? []) {
      if (c.provider && !map.has(c.provider)) map.set(c.provider, c);
    }
    return map;
  }, [connectionsQuery.data]);

  const filtered = useMemo<AvailableConnector[]>(() => {
    const q = search.trim().toLowerCase();
    const all = availableQuery.data ?? [];
    if (!q) return all;
    return all.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [availableQuery.data, search]);

  const pendingProvider = connectMutation.isPending
    ? connectMutation.variables
    : disconnectMutation.isPending
    ? disconnectMutation.variables
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Directory</DialogTitle>
          <DialogDescription className="sr-only">
            Connect external services so the chat agent can take actions on your behalf.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[calc(80vh-4rem)] flex-col gap-4 px-6 py-4 sm:flex-row">
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as typeof tab)}
            orientation="vertical"
            className="sm:w-48"
          >
            <TabsList className="flex w-full justify-start gap-1 sm:flex-col sm:h-auto sm:bg-transparent">
              <TabsTrigger value="connectors" className="justify-start">
                Connectors
              </TabsTrigger>
              <TabsTrigger value="skills" className="justify-start" disabled>
                Skills
              </TabsTrigger>
              <TabsTrigger value="plugins" className="justify-start" disabled>
                Plugins
              </TabsTrigger>
            </TabsList>
            <TabsContent value="skills" className="text-sm text-muted-foreground">
              Coming soon.
            </TabsContent>
            <TabsContent value="plugins" className="text-sm text-muted-foreground">
              Coming soon.
            </TabsContent>
          </Tabs>

          {tab === "connectors" && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search connectors…"
                  className="pl-8"
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {availableQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading connectors…
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No connectors match your search.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {filtered.map((connector) => (
                      <ConnectorCard
                        key={connector.slug}
                        connector={connector}
                        connection={connectionByProvider.get(connector.slug) ?? null}
                        pending={pendingProvider === connector.slug}
                        onConnect={() => connectMutation.mutate(connector.slug)}
                        onDisconnect={() => disconnectMutation.mutate(connector.slug)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {connectionsQuery.isError && (
                <p className="text-xs text-amber-500">
                  Could not load your connections from Composio. The Connect
                  button still works, but status may be stale.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConnectorsDialog;
