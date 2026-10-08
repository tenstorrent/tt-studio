// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TextButton } from "@tenstorrent/vesper/text-button";
import { Badge, BadgeVariant } from "@tenstorrent/vesper/badge";
import { SocialGitHub, Warning } from "@tenstorrent/vesper/icons";
import { Typography } from "@tenstorrent/vesper/typography";
import { Tooltip } from "@tenstorrent/vesper/tooltip";
import { getBuildInfo } from "@/src/api/githubApi";
import { useDeviceState } from "@/src/hooks/useDeviceState";

const BUILD_INFO = getBuildInfo();

export function Footer() {
  const versionLabel = BUILD_INFO.isOfficialRelease
    ? BUILD_INFO.label
    : BUILD_INFO.branch
      ? `· ${BUILD_INFO.branch}`
      : "";

  const appVersionText = `TT Studio${versionLabel ? ` ${versionLabel}` : ""}`;

  return (
    <footer className="h-12 flex items-center justify-between px-vesper-6 py-vesper-3 border-t border-t-vesper-border-tertiary bg-vesper-background-primary">
      <div className="flex items-center gap-vesper-10">
        <TextButton
          iconLeft={<SocialGitHub />}
          as="a"
          href="https://github.com/tenstorrent/tt-studio"
          rel="noopener noreferrer"
          target="_blank"
        >
          {appVersionText}
        </TextButton>
        <div className="flex items-center gap-vesper-2">
          <Typography
            variant="label-md-mono"
            className="text-vesper-text-tertiary uppercase"
          >
            Hardware:
          </Typography>
          <HardwareBadge />
        </div>
      </div>
      <SystemResourcesInfo />
    </footer>
  );
}

function HardwareBadge() {
  const device = useDeviceState();

  const badgeText = device.loading
    ? "Loading..."
    : (device.deviceState?.board_name ?? "Unknown");

  let badgeVariant: BadgeVariant = "warning";
  if (!device.loading) {
    switch (device.deviceState?.state) {
      case "BAD_STATE":
      case "NOT_PRESENT":
        badgeVariant = "danger";
        break;
      case "RESETTING":
      case "UNKNOWN":
        badgeVariant = "warning";
        break;
      case "HEALTHY":
        badgeVariant = "success";
        break;
      default:
        break;
    }
  }

  return (
    <Badge as={Link} to="/" size="sm" variant={badgeVariant} subtle>
      {badgeText}
    </Badge>
  );
}

interface SystemResources {
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: string;
}

function SystemResourcesInfo() {
  const [error, setError] = useState<null | string>(null);
  const [systemResources, setSystemResources] = useState<SystemResources>({
    cpuUsage: 0,
    memoryUsage: 0,
    memoryTotal: "0 GB",
  });

  useEffect(() => {
    let mounted = true;

    // Fetch only CPU/memory resources (board info comes from DeviceStateContext)
    const fetchSystemResources = async () => {
      if (!mounted) return;

      try {
        const response = await fetch("/board-api/footer-data/");
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          throw new Error(`Expected application/json but got ${contentType}`);
        }

        const data = await response.json();

        if (mounted) {
          setSystemResources({
            cpuUsage: data.cpuUsage ?? 0,
            memoryUsage: data.memoryUsage ?? 0,
            memoryTotal: data.memoryTotal ?? "0 GB",
          });
          setError(null);
        }
      } catch (err) {
        console.error("Failed to fetch system resources:", err);
        setError("Failed to fetch system resources");
      }
    };

    // Fetch initial data
    fetchSystemResources();
    // Poll every 5s to keep data fresh
    const interval = setInterval(fetchSystemResources, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const ramUsage = `${systemResources.memoryUsage.toFixed(1)}% (${systemResources.memoryTotal})`;
  const cpuUsage = `${systemResources.cpuUsage.toFixed(1)}%`;

  const device = useDeviceState();

  const devices = device.deviceState?.devices ?? [];
  const avgTemperature =
    devices.length > 0
      ? Math.round(
          (devices.reduce((sum, d) => sum + (d.temperature ?? 0), 0) /
            devices.length) *
            10
        ) / 10
      : 0;

  const hardwareTemp = `${avgTemperature.toFixed(1)}°C`;

  return (
    <div className="flex items-center gap-vesper-3">
      {error && (
        <Tooltip content={error}>
          <Warning className="text-vesper-icon-warning w-5 h-5" />
        </Tooltip>
      )}
      <Typography
        variant="label-sm-mono"
        className="uppercase flex gap-vesper-2"
      >
        <span className="text-vesper-text-tertiary">RAM</span>
        <span className="text-vesper-text-primary">{ramUsage}</span>
      </Typography>
      <Typography
        variant="label-sm-mono"
        className="uppercase flex gap-vesper-2"
      >
        <span className="text-vesper-text-tertiary">CPU</span>
        <span className="text-vesper-text-primary">{cpuUsage}</span>
      </Typography>
      <Typography
        variant="label-sm-mono"
        className="uppercase flex gap-vesper-2"
      >
        <span className="text-vesper-text-tertiary">TEMP</span>
        <span className="text-vesper-text-primary">{hardwareTemp}</span>
      </Typography>
    </div>
  );
}
