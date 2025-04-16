// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ModelCard } from "./ModelCard";
// import { ActionCard } from "./ActionCard";
import { models } from "./data";
import type { Model } from "./types";
// import { Separator } from "../ui/separator";
import ScrollProgressBar from "../ui/scroll-progress-bar";
import { LineShadowText } from "../ui/line-shadow-text";

export function DeployedHome() {
  const scrollToModels = () => {
    const modelsSection = document.getElementById("models-section");
    modelsSection?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="flex flex-col">
      <ScrollProgressBar type="bar" color="#7C68FA" strokeSize={4} />

      {/* Hero Section */}
      <section className="relative min-h-[90vh] w-full flex flex-col items-center justify-center px-4">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <h1 className="text-balance text-5xl font-semibold leading-none tracking-tighter sm:text-6xl md:text-7xl lg:text-8xl text-white">
            Tenstorrent
            <span className="block mt-2 text-[#7C68FA] font-bold">
              AI Playground
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-gray-300">
            Demo and trial ML models running on Tenstorrent hardware
          </p>
          <div className="flex flex-wrap justify-center gap-4 pt-4">
            <button
              onClick={scrollToModels}
              className="px-8 py-3 rounded-lg bg-[#7C68FA] text-white font-semibold hover:bg-[#6C54E8] transition-all duration-200 min-w-[180px]"
            >
              Explore Models
            </button>
            <a
              href="https://tenstorrent.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 rounded-lg border border-[#7C68FA] text-white font-semibold hover:bg-[#7C68FA]/10 transition-all duration-200 min-w-[180px] text-center"
            >
              Learn More
            </a>
          </div>
        </div>

        {/* Scroll indicator */}
        <button
          onClick={scrollToModels}
          className="absolute bottom-[10vh] left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-[#7C68FA] hover:text-[#6C54E8] transition-colors duration-200 cursor-pointer group"
          aria-label="Scroll to models"
        >
          <span className="text-sm font-medium opacity-80 group-hover:opacity-100">
            View Models
          </span>
          <svg
            className="w-8 h-8 animate-bounce"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
          </svg>
        </button>
      </section>

      {/* Models Section */}
      <section
        id="models-section"
        className="min-h-screen w-full px-4 py-24 bg-black/50"
      >
        <div className="max-w-7xl mx-auto">
          <h2 className="text-5xl font-bold text-center mb-16 text-white">
            Available Models
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-3">
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
    </div>
  );
}
