// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ModelCard } from "./ModelCard";
import { ActionCard } from "./ActionCard";
import { models, tasks } from "./data";
import type { Model, Task } from "./types";
import { Separator } from "../ui/separator";

export function DeployedHome() {
  return (
    <div className="container mx-auto px-4 py-8 text-white">
      <section className="mb-12">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
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

      <Separator className="my-12 bg-white/20" />

      <section className="mb-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((task: Task) => (
            <ActionCard
              key={task.id}
              title={task.title}
              path={task.path}
              className={task.className}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
