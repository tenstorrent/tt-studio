// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC
import { DeployedHome } from "../components/aiPlaygroundHome/DeployedHome";

const DeployedHomePage = () => {
  return (
    <>
      <div className="sm:pt-0 pt-16 min-h-screen flex-1 w-full dark:bg-black bg-white dark:bg-dot-white/[0.2] bg-dot-black/[0.2] relative flex items-center justify-center">
        {/* Radial gradient for the container to give a faded look */}
        <div
          className="absolute pointer-events-none inset-0 flex items-center justify-center dark:bg-black bg-white"
          style={{
            maskImage:
              "radial-gradient(ellipse at center, transparent 65%, black 100%)",
          }}
        ></div>
        <div className="flex flex-grow justify-center items-center w-full py-8 md:py-0 md:h-screen">
          <DeployedHome />
        </div>
      </div>
    </>
  );
};

export default DeployedHomePage;
