// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ModelCard } from "./ModelCard";
// import { ActionCard } from "./ActionCard";
import { models } from "./data";
import type { Model } from "./types";
// import { Separator } from "../ui/separator";
import ScrollProgressBar from "../ui/scroll-progress-bar";

export function DeployedHome() {
  return (
    <div className="container mx-auto px-4 py-8 text-white">
      <ScrollProgressBar type="bar" color="#7C68FA" strokeSize={4} />

      <section className="mb-12">
        <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {models.map((model: Model) => (
            <ModelCard
              key={model.id}
              title={model.title}
              image={model.image}
              path={model.path}
              filter={model.filter}
              TTDevice={model.TTDevice}
              poweredByText={model.poweredByText}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
