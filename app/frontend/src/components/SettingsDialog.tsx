// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { customToast } from "./CustomToaster";
import {
  getSettings,
  updateSettings,
  type SettingsResponse,
} from "../api/settingsApi";

const formSchema = z.object({
  jwt_secret: z.string().optional(),
  tavily_api_key: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: getSettings,
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { jwt_secret: "", tavily_api_key: "" },
  });

  useEffect(() => {
    if (open) form.reset({ jwt_secret: "", tavily_api_key: "" });
  }, [open, form]);

  const [confirmJwt, setConfirmJwt] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: FormValues) => {
      const body: Record<string, string> = {};
      if (payload.jwt_secret && payload.jwt_secret.trim() !== "")
        body.jwt_secret = payload.jwt_secret.trim();
      if (payload.tavily_api_key !== undefined)
        body.tavily_api_key = (payload.tavily_api_key || "").trim();
      return updateSettings(body);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (res.requires_redeploy) {
        customToast.success(
          "Settings saved. Redeploy running models/agents to use the new JWT."
        );
      } else {
        customToast.success("Settings saved.");
      }
      setConfirmJwt(false);
      onOpenChange(false);
    },
    onError: (err: any) => {
      customToast.error(
        err?.response?.data?.error || err?.message || "Failed to save settings."
      );
    },
  });

  const onSubmit = (values: FormValues) => {
    const changingJwt = !!(values.jwt_secret && values.jwt_secret.trim() !== "");
    if (changingJwt && !confirmJwt) {
      setConfirmJwt(true);
      return;
    }
    mutation.mutate(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Secrets are stored on the server in the persistent volume.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          autoComplete="off"
        >
          <div className="space-y-1">
            <Label htmlFor="jwt_secret">JWT Secret</Label>
            <Input
              id="jwt_secret"
              type="password"
              autoComplete="new-password"
              placeholder={
                isLoading
                  ? "Loading..."
                  : data?.jwt_secret.set
                    ? `Set (${data.jwt_secret.masked}) – leave blank to keep`
                    : "Enter JWT secret"
              }
              {...form.register("jwt_secret")}
            />
            <p className="text-xs text-stone-500 flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Changing JWT requires redeploying running models and agents.
                If left blank, the existing value is kept.
              </span>
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tavily_api_key">Tavily API Key</Label>
            <Input
              id="tavily_api_key"
              type="password"
              autoComplete="new-password"
              placeholder={
                isLoading
                  ? "Loading..."
                  : data?.tavily_api_key.set
                    ? `Set (${data.tavily_api_key.masked}) – leave blank to keep`
                    : "Enter Tavily API key"
              }
              {...form.register("tavily_api_key")}
            />
            <p className="text-xs text-stone-500">
              Used by the search agent. Get a key at{" "}
              <a
                href="https://tavily.com"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                tavily.com
              </a>
              . Applied to the next agent deployment.
            </p>
          </div>

          {confirmJwt && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs">
              Click Save again to confirm rotating the JWT secret. Already-running
              containers will continue to use the previous secret until redeployed.
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : confirmJwt ? "Confirm Save" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
