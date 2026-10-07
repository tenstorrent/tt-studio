// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState, type ComponentType, type SVGProps } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AIData,
  ClockCounterClockwise,
  Document,
  QuietBox,
  Tenstorrent,
  Sidebar as SidebarIcon,
} from "@tenstorrent/vesper/icons";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Typography } from "@tenstorrent/vesper/typography";
import { cn } from "@/src/lib/utils";

type SidebarItemConfig = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  href: string;
  label: string;
};

const PRIMARY_SIDEBAR_ITEMS: SidebarItemConfig[] = [
  { icon: QuietBox, href: "/", label: "Hardware" },
  { icon: AIData, href: "/models-deployed", label: "Deployments" },
  {
    icon: ClockCounterClockwise,
    href: "/deployment-history",
    label: "Deployment History",
  },
  { icon: Document, href: "/rag-management", label: "Knowledge Base" },
];

const SECONDARY_SIDEBAR_ITEMS: SidebarItemConfig[] = [];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav
      className={cn(
        "shrink-0 flex flex-col bg-vesper-background-tertiary border-r border-r-vesper-border-tertiary overflow-hidden",
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
            "text-vesper-text-primary font-vesper-mono font-normal shrink-0 transition-opacity duration-vesper-default ease-out",
            collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
          )}
        >
          TT-Studio
        </Typography>
      </div>
      <div className="overflow-auto flex flex-col flex-1 shrink min-h-0">
        <SidebarItemList
          collapsed={collapsed}
          items={PRIMARY_SIDEBAR_ITEMS}
          className="pt-vesper-6"
        />
        {SECONDARY_SIDEBAR_ITEMS.length > 0 && (
          <SidebarItemList
            collapsed={collapsed}
            items={SECONDARY_SIDEBAR_ITEMS}
            className="pt-vesper-6 mt-vesper-6 border-t border-t-vesper-border-secondary"
          />
        )}
        <div className="px-vesper-4 pt-vesper-3 flex-1 flex flex-col justify-end">
          <div className="h-16 flex items-center justify-end">
            <IconButton
              icon={<SidebarIcon />}
              variant="ghost"
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="w-11"
            />
          </div>
        </div>
      </div>
    </nav>
  );
}

function SidebarItemList({
  items,
  collapsed,
  className,
}: {
  items: SidebarItemConfig[];
  collapsed: boolean;
  className?: string;
}) {
  return (
    <div className={cn("px-vesper-4 flex flex-col gap-vesper-3", className)}>
      {items.map((item) => (
        <SidebarItem key={item.href} collapsed={collapsed} {...item} />
      ))}
    </div>
  );
}

function SidebarItem({
  href,
  label,
  icon: Icon,
  collapsed,
}: SidebarItemConfig & { collapsed: boolean }) {
  const { pathname } = useLocation();
  const active = href === pathname;

  return (
    <Link
      to={href}
      className={cn(
        "flex items-center rounded-vesper-2 px-vesper-3 gap-vesper-3 h-10",
        active && "bg-vesper-tint-neutral-300 text-vesper-text-primary",
        !active &&
          "text-vesper-text-secondary hover:bg-vesper-tint-neutral-200 hover:text-vesper-text-primary"
      )}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <Typography
        variant="label-md"
        className={cn(
          "shrink-0 transition-opacity duration-vesper-default ease-out",
          collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
        )}
      >
        {label}
      </Typography>
    </Link>
  );
}
