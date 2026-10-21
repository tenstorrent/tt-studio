// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Dispatch, ReactNode, SetStateAction, useState } from "react";
import { IconButton } from "@tenstorrent/vesper/icon-button";
import { Ellipses } from "@tenstorrent/vesper/icons";
import { Chip } from "@tenstorrent/vesper/chip";
import { Toggle } from "@tenstorrent/vesper/toggle";
import { Popover } from "@base-ui/react/popover";
import { ActiveDeployments } from "./components/active-deployments";
import { ModelCard } from "./components/model-card";
import { SolutionCard } from "./components/solution-card";
import { Material } from "@tenstorrent/vesper/material";
import { Typography } from "@tenstorrent/vesper/typography";

export default function ModelsDeployedPage() {
  return (
    <div className="w-full h-full flex">
      <ActiveDeployments />
      <ModelBrowser />
    </div>
  );
}

function ModelBrowser() {
  const [panel, setPanel] = useState("models");

  return (
    <section className="max-h-full flex-1 flex flex-col overflow-auto">
      <div className="px-vesper-10 pt-vesper-10 flex items-center justify-between sticky top-0">
        <Toggle
          value={panel}
          onValueChange={setPanel}
          options={[
            { text: "Models", value: "models" },
            { text: "Solutions", value: "solutions" },
          ]}
        />
        {panel === "models" && <ModelFilters />}
      </div>
      {panel === "models" ? <ModelGrid /> : <SolutionGrid />}
    </section>
  );
}

function ModelFilters({
  verified,
  setVerified,
  unverified,
  setUnverified,
}: {
  verified: boolean;
  unverified: boolean;
  setVerified: Dispatch<SetStateAction<boolean>>;
  setUnverified: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <Popover.Root>
      <IconButton as={Popover.Trigger} icon={<Ellipses />} variant="subtle" />
      <Popover.Portal>
        <Popover.Positioner sideOffset={12} align="end">
          <Material
            as={Popover.Popup}
            className="bg-vesper-background-secondary text-vesper-text-primary w-80 p-vesper-4 flex flex-col gap-vesper-5 divide-y divide-vesper-border-tertiary"
          >
            <Popover.Title className="sr-only">Model Filters</Popover.Title>
            <Popover.Description className="sr-only">
              Search and filter models
            </Popover.Description>
            <ModelFilterSection title="Verification">
              <Chip selected={verified} className="mr-vesper-2">
                TT-Verified
              </Chip>
              <Chip selected={unverified}>Unverified</Chip>
            </ModelFilterSection>
            <ModelFilterSection title="Task">
              <div className="flex gap-2 flex-wrap">
                <Chip>Text-to-Speech</Chip>
                <Chip>Text-to-Video</Chip>
                <Chip>Text-to-Text</Chip>
                <Chip>Text-to-Image</Chip>
              </div>
            </ModelFilterSection>
          </Material>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ModelFilterSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-vesper-3 not-last:pb-vesper-5">
      <Typography variant="label-xs-mono" className="text-vesper-text-tertiary">
        {title}
      </Typography>
      <div>{children}</div>
    </div>
  );
}

function ModelGrid() {
  return (
    <div className="flex-1 min-h-0 grid xl:grid-cols-3 lg:grid-cols-2 gap-vesper-5 p-vesper-10">
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
      <ModelCard />
    </div>
  );
}

function SolutionGrid() {
  return (
    <div className="flex-1 min-h-0 grid xl:grid-cols-3 lg:grid-cols-2 gap-vesper-5 p-vesper-10">
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
      <SolutionCard />
    </div>
  );
}
