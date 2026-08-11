// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  AlertCircle,
  Boxes,
  ExternalLink,
  LayoutGrid,
  MessageSquare,
  Play,
  Square,
  Terminal,
  Globe,
  Workflow,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { Spinner } from "../components/ui/spinner";
import CopyableText from "../components/CopyableText";
import CodeBlock from "../components/chatui/CodeBlock";
import { customToast } from "../components/CustomToaster";
import {
  fetchCodingAgentsInfo,
  type CodingAgentsInfo,
} from "../api/modelsDeployedApis";
import {
  fetchMarketplaceApps,
  launchMarketplaceApp,
  stopMarketplaceApp,
  type MarketplaceApp,
} from "../api/marketplaceApis";
import { GUIDE_BUILDERS, type Guide } from "../lib/marketplaceGuides";
import { getAppLogo } from "../lib/appLogos";
import { useAppReachable } from "../hooks/useAppReachable";
import { cn } from "../lib/utils";

const POLL_INTERVAL_MS = 3000;
const PLACEHOLDER_MODEL = "your-model-name";

const formatBytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

// Fallback icon per category, used until an app has a logo in src/assets/app-logos/.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Chat: MessageSquare,
  Code: Terminal,
  Automation: Workflow,
  Search: Globe,
};

const ALL_CATEGORIES = "All";

const STATUS_LABELS: Record<MarketplaceApp["status"], string> = {
  guide: "Setup guide",
  not_installed: "Not installed",
  pulling: "Downloading",
  starting: "Starting",
  running: "Running",
  stopped: "Stopped",
  error: "Error",
};

const STATUS_DOT: Record<MarketplaceApp["status"], string> = {
  guide: "bg-gray-400",
  not_installed: "bg-gray-400",
  pulling: "bg-TT-yellow",
  starting: "bg-TT-yellow",
  running: "bg-TT-green",
  stopped: "bg-gray-400",
  error: "bg-TT-red-accent",
};

export default function AppsPage() {
  const [apps, setApps] = useState<MarketplaceApp[]>([]);
  const [gateway, setGateway] = useState<CodingAgentsInfo | null>(null);
  const [gatewayConfigured, setGatewayConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [guideApp, setGuideApp] = useState<MarketplaceApp | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES);
  // Apps with a launch/stop request in flight, so buttons can't be double-fired.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const [marketplace, gatewayInfo] = await Promise.all([
      fetchMarketplaceApps(),
      fetchCodingAgentsInfo().catch(() => null),
    ]);
    setApps(marketplace.apps);
    setGatewayConfigured(marketplace.gateway_configured);
    if (gatewayInfo) setGateway(gatewayInfo);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        await load();
        if (!cancelled) setError(null);
      } catch {
        if (!cancelled)
          setError("Could not reach the TT-Studio backend to load apps.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [load]);

  // Host- and protocol-aware so port-forwarded / remote / HTTPS access works.
  const { openaiBase, anthropicBase } = useMemo(() => {
    const scheme = window.location.protocol === "https:" ? "https" : "http";
    const origin = `${scheme}://${window.location.hostname}:${gateway?.gateway_port ?? 4000}`;
    return {
      openaiBase: `${origin}${gateway?.openai_base_path ?? "/v1"}`,
      anthropicBase: origin,
    };
  }, [gateway]);

  const models = useMemo(() => gateway?.models ?? [], [gateway]);
  const modelNames = useMemo(() => models.map((m) => m.name), [models]);
  const activeModel =
    selectedModel && modelNames.includes(selectedModel)
      ? selectedModel
      : (modelNames[0] ?? PLACEHOLDER_MODEL);

  // Filter tabs, in the order categories first appear in the registry so the
  // backend keeps control of ordering.
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const app of apps) {
      counts.set(app.category, (counts.get(app.category) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [apps]);

  // A selected category that disappears (registry change) falls back to showing
  // everything rather than an empty grid.
  const visibleApps = useMemo(() => {
    if (activeCategory === ALL_CATEGORIES) return apps;
    const filtered = apps.filter((app) => app.category === activeCategory);
    return filtered.length ? filtered : apps;
  }, [apps, activeCategory]);

  const appUrl = (app: MarketplaceApp) => {
    const scheme = window.location.protocol === "https:" ? "https" : "http";
    return `${scheme}://${window.location.hostname}:${app.host_port}${app.open_path ?? "/"}`;
  };

  const runAction = async (
    app: MarketplaceApp,
    action: (id: string) => Promise<void>
  ) => {
    setPending((p) => ({ ...p, [app.id]: true }));
    try {
      await action(app.id);
      await load();
    } catch (error) {
      const reason =
        axios.isAxiosError(error) &&
        typeof error.response?.data?.error === "string"
          ? error.response.data.error
          : null;
      customToast.error(
        reason ?? `Could not complete that action for ${app.name}.`
      );
    } finally {
      setPending((p) => ({ ...p, [app.id]: false }));
    }
  };

  const guide: Guide | null = useMemo(() => {
    if (!guideApp) return null;
    const builder = GUIDE_BUILDERS[guideApp.id];
    if (!builder) return null;
    return builder({
      openaiBase,
      anthropicBase,
      apiKey: gateway?.master_key || "<your-api-key>",
      models: models.length ? models : [{ name: PLACEHOLDER_MODEL }],
      activeModel,
    });
  }, [guideApp, openaiBase, anthropicBase, gateway, models, activeModel]);

  return (
    // Full-width root stays transparent so MainLayout's grid shows in the
    // margins; the content column gets its own solid panel background.
    <div className="w-full min-h-screen px-4 sm:px-6 lg:px-8 py-10">
      <div className="max-w-6xl mx-auto space-y-8 bg-white dark:bg-black rounded-2xl border border-gray-200/80 dark:border-gray-800/70 p-6 sm:p-8 shadow-sm dark:shadow-none">
        <header className="space-y-2 pb-2 text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-TT-purple/10 text-TT-purple">
              <LayoutGrid className="h-5 w-5" />
            </span>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              Apps Marketplace
            </h1>
          </div>
          <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            Launch companion apps against your deployed models, or set up ones
            you already have installed.
          </p>
        </header>

        {loading && (
          <div className="flex items-center gap-3 text-gray-500">
            <Spinner /> Loading apps…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && !error && (
          <>
            <GatewayCard
              openaiBase={openaiBase}
              apiKey={gateway?.master_key || ""}
              configured={gatewayConfigured}
              models={modelNames}
              activeModel={activeModel}
              onSelectModel={setSelectedModel}
            />

            {/* Apps that pin one model at launch are blocked individually, but the
                ones that pick models up live are launchable and simply have nothing
                to talk to. One banner covers both cases so the page says the same
                thing everywhere. */}
            {modelNames.length === 0 && (
              <Alert className="border-amber-500/50 text-amber-600 dark:text-amber-500 [&>svg]:text-amber-500">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>No chat model is deployed</AlertTitle>
                <AlertDescription>
                  Apps here talk to your deployed models, so they have nothing
                  to answer with yet.{" "}
                  <Link to="/" className="underline hover:text-TT-purple">
                    Deploy a chat model
                  </Link>{" "}
                  first — some apps cannot be launched until you do.
                </AlertDescription>
              </Alert>
            )}

            <CategoryFilter
              categories={categoryCounts}
              total={apps.length}
              active={activeCategory}
              onSelect={setActiveCategory}
            />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleApps.map((app) => (
                <AppCard
                  key={app.id}
                  app={app}
                  disabled={!!pending[app.id] || !gatewayConfigured}
                  url={app.host_port ? appUrl(app) : null}
                  onLaunch={() => runAction(app, launchMarketplaceApp)}
                  onStop={() => runAction(app, stopMarketplaceApp)}
                  onConnect={() => setGuideApp(app)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <Dialog
        open={!!guideApp}
        onOpenChange={(open) => !open && setGuideApp(null)}
      >
        <DialogContent className="w-[95vw] sm:max-w-3xl lg:max-w-4xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start gap-3 text-left">
              {guideApp && <AppLogo app={guideApp} />}
              <div className="min-w-0">
                <DialogTitle>Connect {guideApp?.name}</DialogTitle>
                <DialogDescription className="mt-1">
                  {guide?.intro}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <ol className="space-y-5">
            {guide?.snippets.map((snippet, index) => (
              <li key={snippet.label} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-TT-purple/10 text-[11px] font-semibold text-TT-purple">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {snippet.label}
                  </span>
                </div>
                {snippet.note && (
                  <p className="pl-7 text-sm text-gray-600 dark:text-gray-300">
                    {snippet.note}
                  </p>
                )}
                <CodeBlock
                  code={snippet.code}
                  language={snippet.language}
                  className="text-left [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:whitespace-pre-wrap [&_code]:break-words"
                />
              </li>
            ))}
          </ol>

          {guideApp && (
            <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
              <a
                href={guideApp.docs_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-TT-purple hover:underline"
              >
                {guideApp.name} documentation
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryFilter({
  categories,
  total,
  active,
  onSelect,
}: {
  categories: readonly (readonly [string, number])[];
  total: number;
  active: string;
  onSelect: (category: string) => void;
}) {
  const tabs: (readonly [string, number])[] = [
    [ALL_CATEGORIES, total],
    ...categories,
  ];

  return (
    <div
      role="tablist"
      aria-label="Filter apps by category"
      className="flex flex-wrap items-center justify-center gap-2"
    >
      {tabs.map(([category, count]) => {
        const Icon =
          category === ALL_CATEGORIES
            ? Boxes
            : (CATEGORY_ICONS[category] ?? Boxes);
        const selected = category === active;
        return (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(category)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              selected
                ? "border-TT-purple bg-TT-purple/10 text-TT-purple font-medium"
                : "border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-TT-purple/50 hover:text-TT-purple"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {category}
            <span
              className={cn(
                "rounded-full px-1.5 text-xs",
                selected
                  ? "bg-TT-purple/20"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">
        {label}
      </div>
      <div className="font-mono text-sm rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2">
        <CopyableText text={value} />
      </div>
    </div>
  );
}

function GatewayCard({
  openaiBase,
  apiKey,
  configured,
  models,
  activeModel,
  onSelectModel,
}: {
  openaiBase: string;
  apiKey: string;
  configured: boolean;
  models: string[];
  activeModel: string;
  onSelectModel: (name: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/60 p-5 sm:p-6 space-y-5">
      <div className="space-y-1.5 text-center">
        <div className="flex items-center justify-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-TT-purple/10 text-TT-purple">
            <Boxes className="h-4 w-4" />
          </span>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            Model gateway
          </h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Every app here talks to this one endpoint. Launched apps are wired to
          it automatically.
        </p>
      </div>

      {!configured && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Gateway not configured</AlertTitle>
          <AlertDescription>
            Set <code>LITELLM_MASTER_KEY</code> in your <code>.env</code> and
            restart TT-Studio to enable apps.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Base URL (OpenAI)" value={openaiBase} />
        <Field label="API Key" value={apiKey || "(not configured)"} />
      </div>

      {models.length > 0 ? (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">
            Model used in setup guides
          </div>
          <div className="flex flex-wrap gap-2">
            {models.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onSelectModel(name)}
                aria-pressed={name === activeModel}
                className={cn(
                  "rounded-full border px-3 py-1.5 font-mono text-xs transition-colors",
                  name === activeModel
                    ? "border-TT-purple bg-TT-purple/10 text-TT-purple font-medium"
                    : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-TT-purple/50 hover:text-TT-purple"
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No chat models deployed</AlertTitle>
          <AlertDescription>
            Apps need a deployed chat model to be useful.{" "}
            <Link to="/models-deployed" className="text-TT-purple underline">
              Go to Models Deployed
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

function AppLogo({ app }: { app: MarketplaceApp }) {
  const logo = getAppLogo(app.id);
  const FallbackIcon = CATEGORY_ICONS[app.category] ?? Boxes;

  return (
    // The chip stays white in both themes: several logos are dark marks or use
    // `currentColor`, which resolves to black inside an <img>.
    <span
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border",
        logo
          ? "border-gray-200 dark:border-gray-700 bg-white"
          : "border-transparent bg-TT-purple/10"
      )}
    >
      {logo ? (
        <img
          src={logo}
          alt=""
          aria-hidden
          className="h-7 w-7 object-contain"
          loading="lazy"
        />
      ) : (
        <FallbackIcon className="h-5 w-5 text-TT-purple" />
      )}
    </span>
  );
}

function AppCard({
  app,
  url,
  disabled,
  onLaunch,
  onStop,
  onConnect,
}: {
  app: MarketplaceApp;
  url: string | null;
  disabled: boolean;
  onLaunch: () => void;
  onStop: () => void;
  onConnect: () => void;
}) {
  const busy = app.status === "pulling" || app.status === "starting";
  const running = app.status === "running";
  const reachable = useAppReachable(running ? url : null);

  return (
    // A launched app is the one thing on this page the user is likely to act on,
    // so it gets a tinted fill, a green ring and a lift the idle tiles don't have.
    <div
      className={cn(
        "group flex h-full flex-col rounded-2xl border p-5 transition-all duration-200",
        running
          ? "border-TT-green bg-TT-green-tint2/40 dark:bg-TT-green/[0.07] ring-2 ring-TT-green/25 shadow-md shadow-TT-green/10 hover:shadow-lg hover:shadow-TT-green/20"
          : cn(
              "bg-white dark:bg-gray-950/40 border-gray-200/90 dark:border-gray-800/80",
              "hover:-translate-y-0.5 hover:border-TT-purple/60 hover:ring-1 hover:ring-TT-purple/20 hover:shadow-lg hover:shadow-TT-purple/5"
            )
      )}
    >
      <div className="flex items-start gap-3">
        <AppLogo app={app} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-gray-900 dark:text-white">
            {app.name}
          </h3>
          <div
            className={cn(
              "mt-0.5 flex items-center gap-1.5 text-xs",
              running
                ? "font-medium text-TT-green-shade dark:text-TT-green"
                : "text-gray-500 dark:text-gray-400"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                STATUS_DOT[app.status],
                (busy || running) && "animate-pulse"
              )}
            />
            {STATUS_LABELS[app.status]}
          </div>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 text-[10px] font-normal text-gray-500 dark:text-gray-400"
        >
          {app.category}
        </Badge>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
        {app.tagline}
      </p>

      <div className="mt-auto pt-5 space-y-3">
        {busy && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Spinner /> {app.message}
            </div>
            {app.progress && app.progress.total_bytes > 0 && (
              <>
                <Progress
                  value={
                    (app.progress.downloaded_bytes / app.progress.total_bytes) *
                    100
                  }
                />
                <div className="text-xs text-gray-500">
                  {formatBytes(app.progress.downloaded_bytes)} of{" "}
                  {formatBytes(app.progress.total_bytes)}
                </div>
              </>
            )}
          </div>
        )}

        {app.status === "error" && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{app.message}</AlertDescription>
          </Alert>
        )}

        {running && reachable === "unreachable" && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Port {app.host_port} isn't reachable</AlertTitle>
            <AlertDescription className="space-y-2">
              <span>
                The app is running on the TT-Studio machine, but your browser
                can't reach that port. If TT-Studio is remote, forward it:
              </span>
              <span className="block font-mono text-xs">
                <CopyableText
                  text={`ssh -L ${app.host_port}:localhost:${app.host_port} <user>@<tt-studio-host>`}
                />
              </span>
            </AlertDescription>
          </Alert>
        )}

        {running && app.first_run_note && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {app.first_run_note}
          </p>
        )}

        {running && app.connection && (
          <dl className="space-y-1.5 rounded-lg bg-gray-50 dark:bg-gray-900/60 p-3 text-xs">
            {[
              ["Base URL", app.connection.base_url],
              ["API key", app.connection.api_key],
              ...(app.connection.model
                ? [["Model", app.connection.model] as const]
                : []),
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-2">
                <dt className="w-16 shrink-0 text-gray-500 dark:text-gray-400">
                  {label}
                </dt>
                <dd className="min-w-0 flex-1 font-mono">
                  <CopyableText text={value} />
                </dd>
              </div>
            ))}
          </dl>
        )}

        {app.kind === "guide" ? (
          <Button variant="outline" className="w-full" onClick={onConnect}>
            <Terminal className="h-4 w-4 mr-2" /> Connect
          </Button>
        ) : running ? (
          <div className="flex gap-2">
            <Button asChild className="flex-1">
              <a href={url ?? "#"} target="_blank" rel="noreferrer">
                Open <ExternalLink className="h-4 w-4 ml-2" />
              </a>
            </Button>
            <Button variant="outline" onClick={onStop} disabled={disabled}>
              <Square className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Button
              className="w-full"
              onClick={onLaunch}
              disabled={disabled || busy || !!app.blocked_reason}
              title={app.blocked_reason ?? undefined}
            >
              <Play className="h-4 w-4 mr-2" />
              {app.status === "error" ? "Retry" : "Launch"}
            </Button>
            {app.blocked_reason && (
              <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>{app.blocked_reason}</span>
              </p>
            )}
          </div>
        )}

        <a
          href={app.docs_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-TT-purple transition-colors"
        >
          Documentation <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
