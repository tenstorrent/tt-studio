// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ModelCard } from "./ModelCard";
// import { ActionCard } from "./ActionCard";
import { models } from "./data";
import type { Model } from "./types";
// import { Separator } from "../ui/separator";
import ScrollProgressBar from "../ui/scroll-progress-bar";
import { Button } from "../ui/button";
import { TypewriterEffectSmooth } from "../ui/typewriter-effect";
import { LineShadowText } from "../ui/line-shadow-text";
import { useState, useEffect } from "react";
import { useHeroSection } from "../../providers/HeroSectionContext";

export function DeployedHome({ onlyCards = false }: { onlyCards?: boolean } = {}) {
  const { showHero } = useHeroSection();

  const scrollToModels = () => {
    const modelsSection = document.getElementById("models-section");
    modelsSection?.scrollIntoView({ behavior: "smooth" });
  };

  const modelTypes = [
    {
      text: "LLM Models",
      className: "text-[#7C68FA] font-semibold",
    },
    {
      text: "Object Detection Models",
      className: "text-[#FF6B6B] font-semibold",
    },
    {
      text: "Speech Recognition Models",
      className: "text-[#4ECDC4] font-semibold",
    },
  ];

  if (onlyCards) {
    return (
      <section
        id="models-section"
        className="min-h-screen w-full px-4 py-16 sm:py-20 md:py-24 bg-white/50 dark:bg-black/50"
      >
        <div className="max-w-[90%] sm:max-w-2xl md:max-w-5xl lg:max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-10 sm:mb-12 md:mb-16 text-gray-900 dark:text-white">
            Available Models
          </h2>
          <div className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(320px,1fr))] max-w-full">
            {models.map((model: Model) => (
              <div key={model.id} className="w-full max-w-[400px] mx-auto">
                <ModelCard
                  title={model.title}
                  image={model.image}
                  path={model.path}
                  filter={model.filter}
                  TTDevice={model.TTDevice}
                  poweredByText={model.poweredByText}
                  modelType={model.modelType}
                  tpBadge={model.tpBadge}
                />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col">
      <ScrollProgressBar type="bar" color="#7C68FA" strokeSize={4} />

      {/* Hero Section */}
      {showHero && (
        <section className="relative min-h-[90vh] w-full flex flex-col items-center justify-center px-4 py-8 sm:py-12 md:py-16">
          <div className="max-w-[90%] sm:max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto text-center space-y-8 sm:space-y-10 md:space-y-12">
            <h1 className="text-balance text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-semibold leading-none tracking-tighter text-gray-900 dark:text-white">
              Tenstorrent
              <span className="block mt-2 sm:mt-3 md:mt-4 text-[#7C68FA] font-bold">
                AI Playground
              </span>
            </h1>
            <div className="flex items-center justify-center w-full">
              <TypewriterEffectSmooth words={modelTypes} className="w-full" />
            </div>
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4 sm:gap-6 pt-4 sm:pt-6 md:pt-8">
              <Button
                onClick={scrollToModels}
                className="w-full sm:w-auto min-w-[180px] bg-[#7C68FA] hover:bg-[#6C54E8] text-white dark:text-white dark:bg-[#7C68FA] dark:hover:bg-[#6C54E8] transition-all duration-200"
              >
                Explore Models
              </Button>
              <Button
                variant="outline"
                className="w-full sm:w-auto min-w-[180px] border-[#7C68FA] text-[#7C68FA] hover:bg-[#7C68FA]/10 dark:border-[#7C68FA] dark:text-[#7C68FA] dark:hover:bg-[#7C68FA]/10 transition-all duration-200"
                asChild
              >
                <a href="https://tenstorrent.com" target="_blank" rel="noopener noreferrer">
                  Learn More
                </a>
              </Button>
            </div>
          </div>
          {/* Scroll indicator - always visible, centered, with margin */}
          <button
            onClick={scrollToModels}
            className="z-20 mt-16 flex flex-col items-center gap-2 text-[#7C68FA] hover:text-[#6C54E8] transition-colors duration-200 cursor-pointer group"
            aria-label="Scroll to models"
          >
            <span className="text-lg font-medium opacity-80 group-hover:opacity-100">
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
      )}

      {/* Models Section */}
      <section
        id="models-section"
        className="min-h-screen w-full px-4 py-16 sm:py-20 md:py-24 bg-white/50 dark:bg-black/50"
      >
        <div className="max-w-[90%] sm:max-w-2xl md:max-w-5xl lg:max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-10 sm:mb-12 md:mb-16 text-gray-900 dark:text-white">
            Available Models
          </h2>
          <div className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(320px,1fr))] max-w-full">
            {models.map((model: Model) => (
              <div key={model.id} className="w-full max-w-[400px] mx-auto">
                <ModelCard
                  title={model.title}
                  image={model.image}
                  path={model.path}
                  filter={model.filter}
                  TTDevice={model.TTDevice}
                  poweredByText={model.poweredByText}
                  modelType={model.modelType}
                  tpBadge={model.tpBadge}
                />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
