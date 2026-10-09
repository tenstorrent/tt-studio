// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useQuery } from "@tanstack/react-query";
import { Button } from "@tenstorrent/vesper/button";
import { Reset, Spinner } from "@tenstorrent/vesper/icons";
import { Typography } from "@tenstorrent/vesper/typography";
import { useDeviceState } from "@/src/hooks/useDeviceState";
import { fetchDeviceTelemetry, TtSmiDevice } from "@/src/api/telemetryApi";
import { Board } from "./components/board";
import { useMemo } from "react";
import { cn } from "@/src/lib/utils";

export default function HomePage() {
  const device = useDeviceState();

  const loadingDeviceState = device.loading;
  const refreshingDeviceState = device.refreshing;
  const fetchingDeviceState = loadingDeviceState || refreshingDeviceState;

  const data = useHardwarePageData();

  const hasMultipleBoards = data.boards.length > 1;

  return (
    <div className="min-h-full flex items-center">
      <div className="w-full flex flex-col justify-center px-vesper-4 py-vesper-10 gap-vesper-12">
        <div className="shrink-0 w-full max-w-6xl mx-auto flex flex-col items-center">
          {loadingDeviceState ? (
            <Typography
              variant="label-sm-mono"
              className="text-vesper-text-secondary uppercase flex items-center gap-vesper-6"
            >
              <Spinner className="w-5 h-5 animate-spin" />
              <span>Detecting hardware</span>
            </Typography>
          ) : (
            <div
              className={cn(
                "grid grid-cols-1 gap-vesper-16 w-full",
                hasMultipleBoards && "lg:grid-cols-2"
              )}
            >
              {data.boards.map((board, index) => (
                <Board
                  key={board.id}
                  board={board}
                  label={hasMultipleBoards ? `Card ${index}` : undefined}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <Button
        variant="subtle"
        size="sm"
        className="fixed top-20 right-vesper-4"
        iconLeft={
          fetchingDeviceState ? <Spinner className="animate-spin" /> : <Reset />
        }
        onClick={device.refresh}
        disabled={fetchingDeviceState}
      >
        {fetchingDeviceState ? "Scanning..." : "Re-scan"}
      </Button>
    </div>
  );
}

type BoardData = { id: string; name: string; devices: TtSmiDevice[] };

type HardwarePageData = {
  boards: BoardData[];
};

function useHardwarePageData(): HardwarePageData {
  const telemetry = useQuery({
    queryFn: fetchDeviceTelemetry,
    initialData: null,
    queryKey: ["device-telemetry"],
  });

  const boards = useMemo(() => {
    const boards: BoardData[] = [];
    if (!telemetry.data) return boards;

    const { device_info } = telemetry.data;
    new Set(
      device_info.flatMap((device) => device.board_info.board_id)
    ).forEach((id) => {
      const devices = device_info.filter(
        (device) => device.board_info.board_id === id
      );
      const name = getCommonPrefix(
        devices.map((device) => device.board_info.board_type)
      );

      const data: BoardData = { devices, name, id };
      boards.push(data);
    });

    return boards;
  }, [telemetry.data]);

  return { boards };
}

function getCommonPrefix(strings: string[]) {
  if (!strings || strings.length === 0) return "";
  if (strings.length === 1) return strings[0];

  const sorted = strings.toSorted();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  let i = 0;
  while (i < first.length && first[i] === last[i]) {
    i++;
  }

  return first.substring(0, i);
}
