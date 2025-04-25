// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { ModelCard } from "./ModelCard";
import { ActionCard } from "./ActionCard";
import { models, tasks } from "./data";
import type { Model } from "./types";
import { Separator } from "../ui/separator";
import ScrollProgressBar from "../ui/scroll-progress-bar";
import { Button } from "../ui/button";
import { TypewriterEffectSmooth } from "../ui/typewriter-effect";
import { LineShadowText } from "../ui/line-shadow-text";

export function DeployedHome() {
  const scrollToTasks = () => {
    const tasksSection = document.getElementById("tasks-section");
    tasksSection?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="flex flex-col">
      <ScrollProgressBar type="bar" color="#7C68FA" strokeSize={4} />

      {/* Models Section */}
      <section
        id="models-section"
        className="w-full px-4 py-8 sm:py-10 md:py-12 bg-white/50 dark:bg-black/50"
      >
        <div className="max-w-[90%] sm:max-w-2xl md:max-w-5xl lg:max-w-7xl mx-auto">
          <div className="flex items-center justify-end mb-8 sm:mb-10 md:mb-12">
            <Button
              onClick={scrollToTasks}
              className="min-w-[140px] bg-[#FF6B6B] hover:bg-[#FF5252] text-white dark:text-white dark:bg-[#FF6B6B] dark:hover:bg-[#FF5252] transition-all duration-200"
            >
              View Tasks
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:gap-6 md:gap-8 md:grid-cols-2 lg:grid-cols-3">
            {models.map((model: Model) => (
              <ModelCard
                key={model.id}
                title={model.title}
                image={model.image}
                path={model.path}
                filter={model.filter}
                TTDevice={model.TTDevice}
                poweredByText={model.poweredByText}
                modelType={model.modelType}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Tasks Section */}
      <section
        id="tasks-section"
        className="w-full px-4 py-8 sm:py-10 md:py-12 bg-[#F8F9FA] dark:bg-[#111214]"
      >
        <div className="max-w-[90%] sm:max-w-2xl md:max-w-5xl lg:max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-8 sm:mb-10 md:mb-12">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-gray-900 dark:text-white">
              NLP Tasks
            </h2>
            <Button
              variant="outline"
              className="min-w-[140px] border-[#7C68FA] text-[#7C68FA] hover:bg-[#7C68FA]/10 dark:border-[#7C68FA] dark:text-[#7C68FA] dark:hover:bg-[#7C68FA]/10 transition-all duration-200"
              asChild
            >
              <a
                href="https://tenstorrent.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Learn More
              </a>
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:gap-6 md:gap-8 md:grid-cols-2 lg:grid-cols-3">
            {tasks.map((task) => (
              <ActionCard
                key={task.id}
                title={task.title}
                path={task.path}
                className={task.className}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}