// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useState, type ComponentType, type SVGProps } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AIData,
  ClockCounterClockwise,
  Document,
  Gear,
  QuietBox,
  Tenstorrent,
  Sidebar as SidebarIcon,
} from "@tenstorrent/vesper/icons";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";
import {
  DEPLOYMENT_HISTORY_PATH,
  DEPLOYMENTS_PATH,
  HOMEPAGE_PATH,
  KNOWLEDGE_BASE_PATH,
  SETTINGS_PATH,
} from "@/src/routes/route-config";
import { useDeployments } from "@/src/vesper/hooks/use-deployments";
import type { DeploymentItem } from "@/src/vesper/types";
import {
  getDemoIcon,
  getDemosForModelType,
  VOICE_AGENT_DEMO,
} from "@/src/vesper/utils/models";

type SidebarItemConfig = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  href: string;
  label: string;
};

const SIDEBAR_ITEMS: SidebarItemConfig[] = [
  { icon: QuietBox, href: HOMEPAGE_PATH, label: "Hardware" },
  { icon: AIData, href: DEPLOYMENTS_PATH, label: "Deployments" },
  {
    icon: ClockCounterClockwise,
    href: DEPLOYMENT_HISTORY_PATH,
    label: "Deployment History",
  },
  { icon: Document, href: KNOWLEDGE_BASE_PATH, label: "Knowledge Base" },
];

/** Demo pages grouped by the deployed model that powers them. */
type DemoGroup = {
  key: string;
  title: string;
  items: (SidebarItemConfig & {
    state?: { containerID: string; modelName: string };
  })[];
};

function useDemoGroups(items: DeploymentItem[]): DemoGroup[] {
  return useMemo(() => {
    const active = items.filter(
      (item) => item.state === "active" && item.containerId
    );
    const groups: DemoGroup[] = active.map((item) => ({
      key: item.key,
      title: item.modelName,
      items: getDemosForModelType(item.modelType).map((demo) => ({
        icon: getDemoIcon(demo.href),
        href: demo.href,
        label: demo.label,
        state: { containerID: item.containerId!, modelName: item.modelName },
      })),
    }));
    // the voice agent chains speech-to-text, an LLM and text-to-speech
    const has = (types: string[]) =>
      active.some((item) =>
        types.includes((item.modelType ?? "").toLowerCase())
      );
    if (has(["chat", "vlm"]) && has(["speech_recognition"]) && has(["tts"])) {
      groups.push({
        key: "voice-agent",
        title: "Voice Agent",
        items: [
          {
            icon: getDemoIcon(VOICE_AGENT_DEMO.href),
            href: VOICE_AGENT_DEMO.href,
            label: VOICE_AGENT_DEMO.label,
          },
        ],
      });
    }
    return groups.filter((group) => group.items.length > 0);
  }, [items]);
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { items } = useDeployments();
  const demoGroups = useDemoGroups(items);
  const hasFailedDeployment = items.some(
    (item) =>
      item.state === "error" ||
      item.state === "download-failed" ||
      item.state === "deploy-failed"
  );
  const hasDeploymentInFlight = items.some(
    (item) => item.state === "downloading" || item.state === "deploying"
  );

  return (
    <nav
      className={cn(
        "shrink-0 flex flex-col text-left bg-vesper-background-tertiary border-r border-r-vesper-border-tertiary overflow-hidden",
        "transition-[width] duration-vesper-default ease-out",
        collapsed ? "w-19" : "w-60"
      )}
    >
      <div className="pl-vesper-6 flex items-center gap-vesper-2 h-16 border-b border-b-vesper-border-tertiary shrink-0">
        <Tenstorrent className="text-vesper-teal-500 w-6 h-6 shrink-0 ml-vesper-half" />
        <Typography
          variant="heading-sm"
          as="h2"
          className={cn(
            "text-vesper-text-primary font-normal shrink-0 transition-opacity duration-vesper-default ease-out",
            collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
          )}
        >
          TT-Studio
        </Typography>
      </div>
      <div className="overflow-auto flex flex-col flex-1 shrink min-h-0">
        <div className="px-vesper-4 py-vesper-6 flex flex-col gap-vesper-3">
          {SIDEBAR_ITEMS.map((item) => (
            <SidebarItem
              key={item.href}
              collapsed={collapsed}
              {...item}
              badge={
                item.href !== DEPLOYMENTS_PATH
                  ? undefined
                  : hasFailedDeployment
                    ? "error"
                    : hasDeploymentInFlight
                      ? "progress"
                      : undefined
              }
            />
          ))}
        </div>
        {demoGroups.length > 0 && (
          <div className="border-t border-t-vesper-border-tertiary px-vesper-4 py-vesper-6 flex flex-col gap-vesper-6">
            {demoGroups.map((group) => (
              <div key={group.key} className="flex flex-col gap-vesper-3">
                {!collapsed && (
                  <Typography
                    as="h3"
                    variant="label-md-mono"
                    className="uppercase font-normal text-vesper-text-primary truncate"
                    title={group.title}
                  >
                    {group.title}
                  </Typography>
                )}
                {group.items.map((item) => (
                  <SidebarItem
                    key={`${group.key}:${item.href}`}
                    collapsed={collapsed}
                    {...item}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="px-vesper-4 pt-vesper-3 flex-1 flex flex-col justify-end">
          <SidebarItem
            href={SETTINGS_PATH}
            icon={Gear}
            label="Settings"
            collapsed={collapsed}
          />
          <div className="h-16 flex items-center justify-end">
            <IconButton
              icon={<SidebarIcon />}
              variant="ghost"
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="w-11"
            />
          </div>
        </div>
      </div>
    </nav>
  );
}

function SidebarItem({
  href,
  label,
  icon: Icon,
  collapsed,
  badge,
  state,
}: SidebarItemConfig & {
  collapsed: boolean;
  /** A dot on the icon: a deployment failed, or one is in progress */
  badge?: "error" | "progress";
  state?: { containerID: string; modelName: string };
}) {
  const location = useLocation();
  const currentContainer = (location.state as { containerID?: string } | null)
    ?.containerID;
  const active =
    href === location.pathname &&
    (!state || !currentContainer || currentContainer === state.containerID);

  return (
    <Link
      to={href}
      state={state}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "flex items-center rounded-vesper-2 px-vesper-3 gap-vesper-3 h-10",
        active && "bg-vesper-tint-neutral-300 text-vesper-text-primary",
        !active &&
          "text-vesper-text-secondary hover:bg-vesper-tint-neutral-200 hover:text-vesper-text-primary"
      )}
    >
      <span className="relative shrink-0">
        <Icon className="w-5 h-5" />
        {badge && (
          <span
            role="img"
            className={cn(
              "absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full",
              badge === "error"
                ? "bg-vesper-background-error-base"
                : "bg-vesper-background-warning-base animate-pulse"
            )}
            aria-label={
              badge === "error"
                ? "A deployment needs attention"
                : "A deployment is in progress"
            }
          />
        )}
      </span>
      <Typography
        variant="label-md"
        className={cn(
          "transition-opacity duration-vesper-default ease-out shrink-0",
          collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
        )}
      >
        {label}
      </Typography>
    </Link>
  );
}
