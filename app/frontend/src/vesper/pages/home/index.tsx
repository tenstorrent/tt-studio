// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useDeviceState } from "@/src/hooks/useDeviceState";
import { Button } from "@tenstorrent/vesper/button";
import { Reset, Spinner } from "@tenstorrent/vesper/icons";
import { Typography } from "@tenstorrent/vesper/typography";
import { Card, type CardProps } from "./components";

const SAMPLE_CARD_PROPS: CardProps = {
  name: "p300",
  paired: true,
  boards: [
    {
      state: "busy",
      tag: "D.01",
      ram: 22.1,
      temp: 46,
      cpu: 17.13,
    },
    {
      state: "busy",
      tag: "D.01",
      ram: 22.1,
      temp: 46,
      cpu: 17.13,
    },
  ],
};

export default function HomePage() {
  const device = useDeviceState();

  const loadingDeviceState = device.loading;
  const refreshingDeviceState = device.refreshing;
  const fetchingDeviceState = loadingDeviceState || refreshingDeviceState;

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
            <div className="grid lg:grid-cols-2 grid-cols-1 w-full gap-vesper-16">
              <Card {...SAMPLE_CARD_PROPS} />
              <Card {...SAMPLE_CARD_PROPS} />
              <Card {...SAMPLE_CARD_PROPS} />
              <Card {...SAMPLE_CARD_PROPS} />
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
