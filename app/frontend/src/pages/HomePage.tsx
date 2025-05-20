// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC
import { useEffect, useState } from "react";
import StepperDemo from "../components/SelectionSteps";
import { DeployedHome } from "../components/aiPlaygroundHome/DeployedHome";

const getSplashEnabled = () => {
  return false;
};

const HomePage = () => {
  const [splashEnabled, setSplashEnabled] = useState(getSplashEnabled());

  useEffect(() => {
    const handler = () => setSplashEnabled(getSplashEnabled());
    window.addEventListener("splash-toggle", handler);
    return () => window.removeEventListener("splash-toggle", handler);
  }, []);

  if (splashEnabled) {
    return (
      <div className="h-screen w-full dark:bg-black bg-white dark:bg-grid-white/[0.2] bg-grid-black/[0.2] relative flex items-center justify-center">
        <div
          className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
          style={{
            maskImage: "radial-gradient(ellipse at center, transparent 45%, black 100%)",
          }}
        ></div>
        <div className="flex flex-grow justify-center items-center w-full h-screen">
          <StepperDemo />
        </div>
      </div>
    );
  }

  // When splash is disabled, show only the model cards
  return (
    <div className="min-h-screen w-full bg-white/95 dark:bg-black/95 flex flex-col items-center justify-start pt-16">
      <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-center mb-10 text-gray-900 dark:text-white">
        Tenstorrent <span className="block text-[#7C68FA]">AI Playground</span>
      </h1>
      <div className="w-full max-w-7xl px-4">
        <DeployedHome onlyCards />
      </div>
    </div>
  );
};

export default HomePage;
